# August Works — Customer Experience, Ambient Operations, AI-Native Interaction & Autonomous Maintenance

## Master Build Brief v9.0 — Research-Audited, Security-Overlaid, Assurance-Hardened & Experience-Specified Golden Master v3

**Date:** 2026-10-07

**Status:** V3 Research-Audited + Security-Overlaid + Assurance-Hardened + Experience-Specified Master Build Brief — implementation-ready architecture and no-guess experience execution specification; system-tested and production-validated claims remain evidence-gated

**Target repository:** `augustkring/august-works`

**Repo baseline audited:** merged `master` @ `4686ec66ce2cc62dd752a316d7074780577b2e91`

**Product:** August Works

**Predecessor Golden Master:** `august-works-organizational-decision-process-intelligence-adaptive-management-master-build-brief-v8-v2.md`

**Predecessor architecture:** V4 Foundation/Context/Memory/Work; V5 Runtime Fabric/Role Packs/Skills/Playbooks/Project Control; V6 SaaS/Managed Runtime; V7 Trust/Learning/Supervision/Safe Execution; V8 Decision/Process Intelligence/Adaptive Management.

**V9 purpose:** make the accumulated capabilities easy to adopt, easy to trust, easy to operate, usable outside the August Works UI, and low-maintenance without weakening authority, safety, privacy or enterprise controls.

---

# 0. Audit honesty, evidence scope and sanity verdict

V9 was not derived by simply extending the prior conceptual recommendation. The direction was re-audited against the current merged repository, the V4–V8 architecture, all 35 supplied playbooks, current primary standards/regulatory guidance, current human-AI interaction research, and current open-source agent/UI protocols.

The complete GitHub tree was inventoried at the audited baseline: **8,623 tracked blobs, 785 directories and ~140 MB**. The UI alone currently contains hundreds of page/component entries, including large onboarding, Inbox/attention, agent, workflow, governance, runtime and advanced administration surfaces. The repository cannot be cloned as a single working tree in the current tool environment, so this audit does not falsely claim that every inherited upstream byte was manually re-read line-by-line. Instead it combines the full tree inventory with direct source reads of the UI shell, onboarding, attention, command palette, runtime/maintenance services, domain owners and predecessor change/evidence surfaces.

All 35 supplied playbooks were materialized as source files, mechanically scanned in full as one corpus, and their V9-relevant sections were read directly and cross-checked against the architecture. The materialized corpus is **139,339 lines / 631,975 words**. This brief does not claim that every specialist rule applies to V9; applicability is scoped by subsystem and consequence.

**Security-source gap closed in V2.** A separate `06 — Security Engineering` playbook was not present in the supplied 35-file corpus. V2 therefore does not pretend that specialist security coverage was supplied when it was not. The final assurance pass closes that gap with a dedicated Security Assurance Overlay anchored in current primary security baselines, especially NIST SSDF 1.1, OWASP ASVS 5.0.0, current OWASP agent-control guidance, and the inherited V4–V8 security/authorization invariants. NIST SSDF 1.2 remains a draft/watch item and is not represented as the current final baseline.

## 0.1 Final sanity verdict

```text
CORE V9 DIRECTION                                    PASS
Fixed six-item navigation as universal law          REJECT
Role/context progressive shell                      PASS
Onboarding as feature education                     REJECT
Onboarding as first-value orchestration              STRONG PASS
Plan/paywall before meaningful value                REJECT
Free Core retained through activation               STRONG PASS
Mandatory BYOK before any experience                CONDITIONAL / test
Small guarded starter-compute allowance             EXPERIMENT, not architecture law
AI-native chat as full authoring surface             PASS with governed drafts
Agent-generated direct production mutation          REJECT
Unified attention/Needs You projection              STRONG PASS
Separate notification source of truth               REJECT
Background maintenance autopilot                    STRONG PASS with risk tiers
Maximal autonomy as UX goal                         REJECT
Correct work allocation + low customer effort       STRONG PASS
New UI framework                                     REJECT
Reuse assistant-ui/Base UI/Radix/cmdk               STRONG PASS
AG-UI                                                OPTIONAL boundary adapter
A2UI                                                 COMPATIBILITY/pattern; v1 candidate not hard dependency
MCP Apps                                             STRONG optional extension for rich third-party tool UI
Self-host product analytics by default               REJECT as low-maintenance goal
Managed/EU product analytics adapter                 OPTIONAL after privacy/DPA review
Premium = gradients/glass/AI decoration             REJECT
Premium = hierarchy/restraint/craft                 STRONG PASS
WCAG 2.2 AA                                          PRODUCT BASELINE
EN 301 549 v4.1.1                                    DESIGN TARGET; legal harmonisation status tracked
"Time in app" as product success                     REJECT
Time to useful outcome / human effort / maintenance  STRONG PASS
Security assurance as implicit concern                REJECT
Explicit security assurance overlay                   STRONG PASS
Precision-only attention metric                       REJECT
Precision + critical recall / miss evidence           STRONG PASS
Research review as production validation              REJECT
Staged assurance lifecycle                            STRONG PASS
```

## 0.2 What changed from the first V9 concept

The initial direction proposed a very small fixed top-level navigation. The research does **not** support a universal menu-count rule. V9 therefore defines a role- and context-sensitive information architecture with an intentionally small default surface, while exact labels/counts remain usability-tested implementation choices.

The initial direction also treated starter compute as an obvious onboarding answer. V9 instead treats it as a commercial/product experiment behind strict abuse/cost gates. Zero-friction value is the goal; a particular subsidy model is not an architecture invariant.

Finally, V9 formalizes that 'low maintenance' cannot mean hidden uncontrolled mutation. Maintenance automation must be deterministic where possible, bounded, idempotent, observable, postcondition-verified and risk-tiered.


## 0.3 V2 final falsification and assurance-hardening verdict

The final V2 pass did **not** identify a new architecture-breaking defect in the V9 product direction. It did identify material assurance gaps that could otherwise create false confidence during implementation or release.

V2 therefore retains the V1 product/experience architecture and makes the following nine changes normative:

1. **Security Assurance Overlay.** Security claims now map `threat → invariant/control → verification → evidence → owner → closure`; the missing supplied Security Engineering playbook is not silently assumed.
2. **Criticality & Assurance Matrix.** V9 separates system/action consequence (`C0–C4`) from Maintenance classes (`M0–M4`) so assurance depth scales explicitly with consequence, exposure, autonomy, irreversibility, blast radius, recoverability and detectability.
3. **Pre-registered formal validation.** Exploratory pilots may establish baselines; formal release validation freezes the population/journey, oracle and `PASS / FAIL / INCONCLUSIVE` rules before the confirmatory run.
4. **Attention precision + recall.** `Actionable Attention Precision` remains useful but cannot stand alone; critical missed/late human-action conditions are first-class product failures.
5. **Untrusted discovery ingestion.** Public/customer documents used for Foundation bootstrap are data, never instruction or authority; prompt-injection and provenance controls are structural.
6. **Maintenance concurrency and authority hardening.** Self-repair gains desired-state authority, version/fencing controls, kill paths, blast-radius budgets, loop breakers and state-compatible recovery.
7. **Experience Orchestrator resilience contract.** Projection reads may degrade truthfully; consequential writes fail closed when freshness, authorization or current canonical version cannot be established.
8. **Analytics Data Processing Contract.** Experience telemetry uses allow-listed, purpose-bound fields with retention, deletion, access, processor and test contracts; provider region is not treated as proof of complete data residency/compliance.
9. **Safe Change Program.** Shell/onboarding/schema/notification migrations require valid intermediate states, mixed-version reasoning, reconciliation, irreversible-boundary tracking, cutover evidence and cleanup ownership.

The V2 release status is therefore:

```text
RESEARCH-AUDITED          EARNED
SECURITY-OVERLAID         EARNED
ASSURANCE-HARDENED        EARNED
IMPLEMENTATION-READY      EARNED
SYSTEM-TESTED             NOT YET EARNED
PRODUCTION-VALIDATED      NOT YET EARNED
```

The inherited V6/V7 physical-hosting/runtime blocker groups remain open until their own evidence gates pass. V2 does not convert design quality into production evidence.



## 0.4 V3 no-guess experience-execution verdict

V2 established a strong customer-first architecture, security/authority model, resilience model and assurance program. The final experience audit identified a different class of remaining risk: **implementation ambiguity**.

A competent coding agent could follow V2 and still make materially different local UX decisions about:

- which screen appears at each journey step;
- which information is visible before a decision;
- which fields are required or optional;
- primary/secondary action wording;
- when a permission is requested;
- whether a confirmation, undo or direct action is appropriate;
- how a live agent revision becomes active;
- when one agent versus a workflow versus multiple agents is the right customer-facing model;
- how workflow testing/publishing/operation/recovery is represented;
- where governance/compliance/settings live;
- how loading, stale, error, recovery and success states behave;
- focus, keyboard and screen-reader behavior;
- how users can give product feedback from any surface.

That ambiguity is unacceptable for the V9 implementation target.

V3 therefore adds a **No-Guess Experience Execution Layer**. Research and standards determine the durable human-centred constraints; August Works then deliberately freezes exact product defaults as `HOUSE` decisions so implementation agents do not invent product/UX policy.

### Evidence versus HOUSE decisions

V3 distinguishes:

```text
STRONG EXTERNAL / PLAYBOOK EVIDENCE
→ user outcomes before product structure
→ minimum justified effort
→ first value early
→ just-in-time permissions
→ recognition over recall
→ familiar controls
→ visible state/consequence/recovery
→ progressive disclosure without hidden risk
→ accessible/keyboard-operable interaction
→ governed AI authority
→ test before publish
→ feedback near context/task completion
→ feedback ≠ urgent support
→ privacy/data minimization

AUGUST WORKS HOUSE STANDARD
→ exact navigation projection by experience profile
→ exact 12-screen activation default
→ exact Hire Agent and Custom Agent flows
→ exact agent lifecycle labels
→ exact workflow lifecycle
→ exact Company/Settings IA
→ exact global feedback trigger and feedback categories
→ exact copy, state and interaction contracts below
```

The HOUSE layer is not represented as universal science. It is the deliberate, evidence-informed product standard to be implemented until representative customer evidence justifies a controlled change.

## 0.5 Repository feedback finding

The audited repository already contains `ui/src/components/OutputFeedbackButtons.tsx`. It provides `Helpful` / `Needs work` feedback on individual AI outputs and, at the audited baseline, contains a sharing prompt that refers to sharing voted AI outputs with **Paperclip Labs**.

V3 makes the following architectural distinction:

```text
AI OUTPUT FEEDBACK
quality/correction signal tied to a specific AI result
→ tenant-local learning/correction by default

PRODUCT FEEDBACK
bug / usability improvement / product idea / other feedback
→ August Works Customer Feedback domain
```

The existing Paperclip Labs sharing path is **not** the V9 global customer-feedback solution and MUST NOT be carried forward as implicit consent to share content with August Works. Any prior Paperclip-oriented sharing preference requires migration/reconfirmation rather than silent reinterpretation.


# 1. Executive thesis

> **August Works should absorb organizational and technical complexity so customers do not have to administer an AI platform in order to benefit from an AI-native company.**

V4–V8 built substantial capability. V9 changes the customer relationship to that capability. The ordinary employee should be able to work through Slack, Teams, email, meetings or a simple August Works conversational surface. Managers should see only material changes, decisions and exceptions. AI/technical administrators should retain full control when needed. Platform operators should have dedicated operational tooling without leaking infrastructure complexity into customer workflows.

```text
BEFORE V9
user learns August Works
→ configures platform concepts
→ watches agents
→ manages exceptions
→ gets value

V9 TARGET
user states outcome / works normally
→ August Works resolves context + capability
→ agents/workflows execute under existing governance
→ platform supervises, repairs and learns
→ user is interrupted only when judgment/authority is required
→ useful outcome appears in the surface the user already uses
```

The product should become increasingly **ambient** without becoming invisible in the deceptive sense. AI identity, authority, consequences, permissions and material uncertainty remain visible at the point where they matter.

# 2. North-star experience principles

**P-01 — OUTCOME BEFORE PRODUCT EDUCATION.** A customer should experience useful work before being taught internal feature taxonomy.

**P-02 — COMPLEXITY ABSORPTION.** Internal architecture complexity belongs behind the interface unless it changes the user's decision.

**P-03 — PROGRESSIVE DISCLOSURE.** Show what is needed to act correctly now; preserve deeper evidence and expert controls.

**P-04 — AMBIENT BY DEFAULT.** Normal work can happen outside the AW application; the control plane stays authoritative underneath.

**P-05 — ATTENTION IS SCARCE.** The platform must optimize human interruptions, not maximize notifications or screen time.

**P-06 — AUTOMATE TOIL, NOT AUTHORITY.** Automate repeatable maintenance; do not silently automate judgment, consent or material authority.

**P-07 — AI IS A COLLABORATOR, NOT AN ORACLE.** Support invocation, dismissal, correction, explanation, takeover and reset.

**P-08 — ONE PRODUCT, MULTIPLE DEPTHS.** Novice/member/manager/admin/operator experiences are projections of one system, not forks.

**P-09 — SERVER AUTHORITY SURVIVES UX SIMPLIFICATION.** UI hiding, chat convenience and generated UI never weaken authorization.

**P-10 — FIRST-CLASS FAILURE UX.** Loading, stale, partial, offline, blocked and recovery states are product states.

**P-11 — ACCESSIBILITY IS A FLOOR.** WCAG 2.2 AA and keyboard/assistive-technology behavior are requirements, not polish.

**P-12 — PREMIUM THROUGH CRAFT.** Hierarchy, restraint, typography, rhythm, consistency and state quality—not AI clichés—create premium feel.

**P-13 — LOW MAINTENANCE IS MEASURED.** Track customer upkeep minutes, repair success and support escalation rather than assuming automation helped.

**P-14 — NO NEW SOURCE OF TRUTH FOR EXPERIENCE.** Home, Needs You and agent UI are projections over canonical V4–V8 domains.

**P-15 — VALUE CAN LIVE OUTSIDE THE APP.** A successful day may involve zero visits to August Works.

# 3. Predecessor architecture relationship

V9 is a cross-cutting product/operations layer. It does not supersede predecessor authority.

| Predecessor | V9 consumes | V9 must not redefine |
|---|---|---|

| V4 | Foundation, Context, Memory, Tasks, Workflows, Pipelines, Decisions, Optimizer, audit | canonical business truth, memory lifecycle, workflow authority, deterministic-first doctrine |

| V5 | agent identity/presence, Runtime Fabric, Role Packs, Skills, Playbooks, Roadmap, Portfolio | company-local authority, execution manifests, skill/playbook governance |

| V6 | accounts, onboarding run, notifications, billing/entitlements, managed runtime, support, backups/deletion | commercial/runtime source of truth and production qualification gates |

| V7 | Readiness, cognitive/derived memory, learning, orchestration, supervision, verification, Work Signals, OpenShell, Agent Packages, Core Stewards | trust/governance/sandbox authority and unresolved hosting blockers |

| V8 | metrics, process/decision intelligence, scenarios, experiments, adaptive planning, executive review | analytical evidence standards and formal decision authority |

V9 therefore uses the pattern: **project → explain → collect intent → call existing domain service → show receipt**. It does not persist a duplicate business object merely to make a screen convenient.

# 4. Current repository experience audit

The current source demonstrates both strong foundations and accumulated customer-surface debt.

## 4.1 Assets to preserve

- Streamlined shell is already the default (`useStreamlinedUiEnabled` fails open to streamlined).

- `WhatNeedsMe` already aggregates attention/decision work with keyboard operation, grouping, snooze/dismiss and history.

- `CommandPalette` already provides Cmd/Ctrl+K, deterministic navigation/search and entity access.

- `OnboardingChat` and onboarding primitives already exist.

- V6 has durable `company_onboarding_runs`, SaaS notifications, notification preferences and support sessions.

- V7 has Core Stewards, Readiness, Learning, Supervision and safe maintenance primitives.

- Repository contains managed-resource drift, recovery observability, local-service supervision and status-card background refresh logic.

- assistant-ui, Base UI, Radix, cmdk, TanStack Query, Motion, Storybook a11y, Playwright, i18next and XYFlow are already dependencies/capabilities.

- The chat stack already supports Slack, Teams, Discord, Telegram, GitHub and other channel-specific behavior.

- V4 already supports AI-authored workflow drafts with explicit graph/test/publish semantics.

## 4.2 Product-surface debt

- Backend domain names leak into customer navigation: Readiness, Cognitive Providers, Derived Intelligence, Organizational Learning, Runtime Fabric, Role Packs, Orchestration, Work Signals, Security Export and similar concepts.

- There are multiple onboarding concepts (`OnboardingWizard`, `SetupWizard`, `SaasWelcome`, onboarding seeds/chat).

- The SaaS onboarding sequence still reflects an older plan/runtime/provider-first model and includes a plan stage before demonstrated value.

- Agent configuration exposes implementation concerns that Agent Packages can increasingly hide.

- Notifications and attention exist as separate surfaces without one explicit customer interruption policy.

- Legacy/production/streamlined variants and feature-gated surfaces increase UI maintenance and test surface.

- Many advanced pages are necessary for admins/operators but are too prominent for ordinary members when enabled.

- The global command palette is navigation-first; it has not yet become a universal Ask/Create/Run interface.

## 4.3 V9 convergence objective

```text
KEEP CAPABILITIES
REDUCE CUSTOMER CONCEPTS
REDUCE NORMAL-MODE NAVIGATION
REDUCE DUPLICATE SURFACES
REDUCE REQUIRED SETUP
REDUCE HUMAN INTERRUPTIONS
REDUCE CUSTOMER MAINTENANCE
REDUCE SUPPORT DEPENDENCE

while increasing:
TASK SUCCESS
TRUST / CONTROL
ACCESSIBILITY
FIRST-VALUE SPEED
RECOVERY
TRACEABILITY
PREMIUM CRAFT
```

# 5. Research and standards basis

V9 uses a hierarchy of evidence: applicable law/standards first; validated HCI/UX evidence; mature platform guidance; then open-source implementation patterns. Popularity alone is not authority.

## 5.1 Human-centred design

Use ISO 9241-210:2019 as the lifecycle-level human-centred design reference and ISO 9241-11:2018 for usability as effectiveness, efficiency and satisfaction in context. ISO 9241-210 remains current after 2025 review.

## 5.2 Onboarding

Apple HIG onboarding guidance supports fast/optional onboarding, teaching through interaction, postponing nonessential setup, using reasonable defaults and requesting permissions at understandable need. AWS SaaS Lens independently requires frictionless, repeatable, automated tenant onboarding to accelerate time-to-value and avoid operational growth proportional to customer count.

## 5.3 Human-AI interaction

Microsoft HAX's validated guidelines require clear capability/quality expectations, context-timed services, efficient invocation/dismissal/correction, graceful scoping under uncertainty, understandable reasons, cautious adaptation, granular feedback, global controls and change notifications. Google PAIR similarly emphasizes calibrated trust, feedback/control, progressive automation and graceful failure.

## 5.4 Human agency

Stanford HAI's human-in-the-loop guidance supports granular human participation rather than only all-or-nothing automation. Recent Stanford commentary on increasingly autonomous multi-agent systems strengthens the need for deterministic guardrails, monitoring and escalation. MIT CCI's meta-analysis warns that human+AI combinations do not automatically outperform the best human-only or AI-only systems; V9 must therefore allocate work by evidence and consequence, not ideology.

## 5.5 Accessibility

WCAG 2.2 AA is the V9 product baseline. EN 301 549 v4.1.1 was published in September 2026 and adopts WCAG 2.2, but has not yet replaced v3.2.1 as the harmonized EU legal reference at this audit date. V9 tracks that distinction explicitly.

## 5.6 Privacy and transparent AI

GDPR privacy-by-design/default requires protective defaults and continual review. AI Act Article 4 requires context-appropriate AI literacy measures; Article 50 requires direct AI interaction transparency where applicable. V9 builds these into the interface rather than relegating them to legal documentation.

## 5.7 Low-maintenance operations

Google SRE's toil framing is directly applicable: if normal operation requires repeated manual intervention that can be automated, it is a product/engineering defect candidate. V9 treats both customer toil and August Works operator toil as measurable system costs.


## 5.8 Security assurance basis

V9 is a customer-experience layer over consequential multi-tenant, AI-enabled, tool-using software. Security is therefore a lifecycle/architecture property, not a penetration-test phase and not a hidden implication of server authorization.

Because no standalone `06 — Security Engineering` playbook was supplied in the audited playbook corpus, V2 uses an explicit security overlay instead of overstating coverage.

### Current baseline hierarchy

| Source | V9 use | Status treatment |
|---|---|---|
| NIST SP 800-218 — SSDF 1.1 | secure SDLC/process baseline | current final baseline |
| NIST SP 800-218 Rev.1 — SSDF 1.2 | future/draft watch item | Initial Public Draft; must not silently replace 1.1 |
| OWASP ASVS 5.0.0 | verifiable web/application security requirements | current OWASP ASVS baseline |
| OWASP Agent Control Standard | runtime inspectability/control hooks for agent systems | current applied/emerging agent-control guidance; not treated as empirically complete |
| V4–V8 authority/security controls | product-specific invariants | canonical AW authority and control plane |

### Security assurance chain

For every material V9 threat:

```text
THREAT / ABUSE CASE
→ ASSET + TRUST BOUNDARY
→ SECURITY INVARIANT
→ PREVENTIVE / DETECTIVE / RECOVERY CONTROL
→ VERIFICATION METHOD
→ EVIDENCE ARTIFACT
→ OWNER
→ RESIDUAL RISK / EXCEPTION
→ CLOSURE / REVALIDATION TRIGGER
```

A threat scenario is not considered covered merely because it appears in a document. `SECURITY-COVERED` requires an implemented control and retained evidence appropriate to consequence.

### Non-negotiable security invariants

- authorization is resolved at a trusted server/control-plane boundary, never from hidden UI, client claims, model output or generated component IDs;
- natural-language content, retrieved content, tool output and generated UI are untrusted inputs;
- tenant selection is not authorization;
- privileged actions use current principal, tenant/company scope, target resource, operation, current policy/grant and relevant version/state at execution time;
- authentication, OAuth consent or a valid signature does not by itself prove business authorization;
- deterministic limits protect permissions, tenant isolation, destructive actions, spending/financial authority, credential access and other hard controls;
- no model, agent, MCP App, AG-UI/A2UI message or channel adapter can widen its own authority;
- security logging/audit must avoid creating a new secrets/privacy leakage path;
- rate, step, budget, concurrency and blast-radius limits are part of agent/action security where abuse can amplify;
- kill/revocation paths must not depend entirely on the agent/runtime being stopped;
- security-critical scanner/control outage is represented as `ERROR / UNAVAILABLE`, never silently as success;
- high-consequence security changes require independent evidence/review proportionate to criticality.

### V9 security assurance package

Before GA, the retained evidence package must connect at least:

```text
security requirement / threat ID
→ implementation/control ID
→ code/config/policy version
→ automated/manual/adversarial test ID
→ exact released artifact/revision
→ test result
→ residual risk / exception if any
→ accountable owner
```

The Security / Abuse Threat Scenarios in §65 are minimum required negative tests, not an exhaustive threat model.


# 6. Playbook applicability synthesis

All supplied playbooks remain applicable through the parent/specialist overlay model. V9 uses the following direct groups most heavily:

- UX / UI / universal design / web frontend: journey, IA, accessibility, state completeness, progressive disclosure, testing.
- Visual design/art direction/graphics: hierarchy, restraint, brand grammar, rendered-state QA.
- Agentic AI / AI-ML: autonomy envelopes, oversight, evals, uncertainty, feedback.
- Reliability / maintenance / DevOps: toil, self-healing, recovery, safe upgrades and lifecycle.
- Privacy / security / data: protective defaults, minimization, retention, tenant isolation, derived-state rules.
- Requirements / architecture / verification: explicit boundaries, acceptance evidence and non-goals.
- Business design / market validation / measurement: first-value, activation, freemium experiments and evidence.

The complete playbook inventory is reproduced in Appendix A.


## 6.1 V9 Criticality & Assurance Matrix

V9 applies one explicit consequence model across experience, AI, maintenance and release decisions.

`C0–C4` describes the consequence/assurance level of the capability or action. It is **not** the same taxonomy as Maintenance Autopilot `M0–M4`, which classifies maintenance action type.

| Criticality | Typical V9 example | Minimum assurance posture |
|---|---|---|
| `C0 Experimental` | isolated prototype with synthetic/non-sensitive data and no material external effects | explicit non-production status, basic hygiene |
| `C1 Ordinary` | reversible assistive drafting/status UX with low-value consequences | representative tests, ordinary security/privacy, telemetry, safe fallback |
| `C2 Material` | customer/company data, meaningful workflow, revenue-related analysis, production dependency, external business process | strong eval/test suite, controlled rollout, monitoring, provenance, incident/recovery path |
| `C3 High assurance` | permission expansion, credential grants, destructive state change, financial/spend authority, security-policy changes, high-impact external communication | independent/adversarial evidence, explicit approval/separation where relevant, stronger traceability, kill/recovery path, field evidence |
| `C4 Safety / mission critical` | domain where severe injury/life/mission-critical consequences become credible | applicable external domain safety/certification standard governs |

Assurance selection uses the reasoning model:

```text
CONSEQUENCE
× EXPOSURE
× IRREVERSIBILITY
× UNCERTAINTY
× BLAST RADIUS
× AUTONOMY
÷ (RECOVERABILITY × DETECTABILITY)
→ REQUIRED ASSURANCE
```

This is not arithmetic and must not become a numeric compliance score.

### Assurance mapping rule

Every material `ExperienceAction`, maintenance operation, generated/proposed mutation and acceptance journey SHOULD have an explicit criticality class or inherit one from its canonical domain operation. UI convenience MUST NOT downgrade the domain's assurance class.

### Evidence margin

For `C2+` AI/probabilistic behavior, release should not rely on a point estimate barely over a threshold when variance, sample uncertainty or distribution shift is material. Formal release evidence records the margin/uncertainty around the acceptance claim and any critical slices that behave materially worse than the aggregate.


# 7. V9 customer mental model

The customer model should become smaller than the implementation model. Default customer concepts:

```text
HOME
what matters now

NEEDS YOU
judgment / authority / exception

WORK
projects, tasks, routines, workflows as outcomes

AGENTS
AI employees and specialists

INSIGHTS
business/process/decision intelligence when relevant

APPS
connected systems

COMPANY / SETTINGS
knowledge, people, trust, billing, advanced administration

ASK AUGUST
universal conversational entrypoint across the product
```

This is a **reference IA**, not a fixed numerical law. Exact top-level items and labels MUST be tested with representative customers. The invariant is that customer goals/objects—not database tables or architecture teams—drive the default grouping.

**V3 implementation lock:** §77 defines the canonical launch presentation by experience profile. A coding agent MUST implement that projection rather than independently simplifying or expanding navigation.

# 8. Experience roles and progressive depth

V9 introduces **experience profiles**, not authorization roles. Authorization remains V4/V5/V7 server-side. Experience profiles only choose presentation depth.

| Experience profile | Typical need | Default depth |
|---|---|---|
| Member | ask agents, follow work, respond when needed | minimal |
| Manager/Owner | priorities, decisions, outcomes, insights | operational/management |
| AI Lead/Admin | configure agents/apps/policies/evals | advanced |
| Security/Compliance Admin | governance, evidence, identity, export | advanced trust/security |
| Platform Operator (AW internal) | infrastructure/qualification/recovery | operator-only |

Profile resolution should derive from current membership/permissions and user preference. It MUST NOT grant authority. A user may opt into more detail if already authorized.

## 8.1 Progressive disclosure rule

Hide rare implementation controls, not consequences. Price, permission scope, irreversible effects, data use, risk, uncertainty and required action stay visible when relevant.

# 9. Experience Orchestrator

Create an internal Experience Orchestrator service layer that assembles user-facing projections from authoritative domains. It is not a workflow engine, policy engine or source of truth.

```text
SURFACE REQUEST
(web / Slack / Teams / email / chat)
        ↓
resolve actor + company + permissions
        ↓
resolve experience context
(role depth + current object + device/surface + preferences)
        ↓
read canonical domains
Tasks / Decisions / Approvals / Agents / Readiness / Governance / V8 Insights
        ↓
compose ExperienceModel / ActionCard
        ↓
render through surface adapter
        ↓
USER ACTION
        ↓
canonical domain API with expected version / approval / authorization
        ↓
receipt + refreshed projection
```

## 9.1 Mandatory properties

- no direct database writes outside owning domain service;
- no authorization derived from UI visibility;
- no hidden material side effects;
- all action cards reference canonical resource IDs/versions;
- stale cards fail closed and refresh;
- channel renderers may simplify presentation but not change authority;
- user-visible explanations use audit-safe rationale/evidence, never hidden chain-of-thought.


## 9.2 Projection resilience and failure contract

The Experience Orchestrator creates a convenient fan-in point across many domains and must not become a fragile hidden control plane.

### Read path

Read projections MAY degrade partially when the missing domain does not make the shown result misleading. Every material projection field/card must carry or make recoverable:

- canonical source/domain;
- source resource/version where material;
- freshness or observation time;
- whether the value is authoritative, derived or temporarily unavailable;
- evidence/provenance summary where the decision depends on it.

Example:

```text
Home
✓ Needs You        fresh
✓ In Progress      fresh
! Ads connection   temporarily unavailable — last verified 09:42
✓ Done             fresh
```

Do not replace `UNKNOWN / UNAVAILABLE / STALE` with a fabricated healthy/default state.

### Write/action path

Consequential actions MUST fail closed when any required condition cannot be established at execution time:

- current actor/principal;
- current company/tenant scope;
- target canonical resource;
- authorization/grant/policy;
- required expected/current version;
- risk/approval requirement;
- material precondition.

A cached `ExperienceCard`, generated component or channel message is never sufficient authority.

### Distributed-systems controls

For each material projection dependency define:

```text
total deadline
cancellation
per-dependency budget
bounded concurrency/fan-out
retry eligibility + retry budget
cache/freshness semantics
partial-result semantics
overload/admission behavior
correlation / trace context
fallback / degradation behavior
```

Retries are allowed only for plausibly transient and safe-to-repeat reads/effects inside a total deadline/resource budget.

### Operability

The Orchestrator must expose user-relevant and dependency-level telemetry sufficient to distinguish:

- canonical domain failure;
- projection/composition failure;
- stale cache;
- authorization denial;
- timeout;
- overload;
- channel-rendering failure;
- data-quality/provenance gap.

No customer-visible critical flow is considered reliable from component uptime alone.


# 10. Home — ambient company summary

Evolve the current Dashboard into a customer-oriented Home. Preserve `/dashboard` compatibility; a route rename is optional. Home is a projection, not a new storage domain.

```text
NEEDS YOU
only material items requiring this user's action

IN PROGRESS
important work currently executing

DONE
meaningful outcomes since last visit / selected period

WATCH
risks, blockers, anomalies and V8 insights that are useful but not yet action-required

ASK AUGUST
one universal entrypoint
```

When there is no meaningful action: show a confident empty state such as `All caught up — your agents are working`, not fabricated dashboard noise.

## 10.1 Home item sources

Needs You → existing attention/decision/approval/readiness/governance queues.

In Progress → Tasks/Workflow runs/Orchestration/Agent runs.

Done → authoritative activity/outcomes.

Watch → Status Cards, V8 metrics/process/forecast signals, runtime/connection degradation.

# 11. Needs You — one human-attention contract

Use the existing attention/decision queue as the canonical action-needed projection. Do not build a second action queue. `WhatNeedsMe` is the strongest current substrate and should be productized into the default customer concept `Needs You` (exact label subject to testing).

## 11.1 Every item answers four questions

```text
WHAT happened?
WHY does it require me?
WHAT happens if I do nothing?
WHAT can I do now?
```

## 11.2 Item actions

Resolve inline when safe: approve/reject, answer, correct, reconnect, retry, snooze, dismiss, stop. Link to a full expert view only when the decision genuinely needs more information.

## 11.3 Attention precision

Track `actionable attention precision`: proportion of surfaced items users act on, retain or mark useful. False-positive interruptions are a product defect signal.


## 11.4 Attention quality = precision + critical recall

`Actionable Attention Precision` is useful but cannot be the sole success metric. A system can achieve perfect precision by interrupting nobody and missing important required human action.

For each consequential attention class, evaluate at least:

- **Actionable Attention Precision** — surfaced items that were genuinely useful/actionable;
- **Critical Attention Recall** — material conditions requiring human judgment/authority that were surfaced correctly;
- **Missed Critical Attention Rate** — conditions that required timely human action but were not surfaced;
- **Late Critical Attention Rate** — surfaced after the action window materially degraded;
- **Duplicate Interruption Rate** — repeated interruptions for the same canonical condition without new decision value;
- **Unnecessary Interruption Rate** — interruptions that should have remained silent/digest/history;
- **Unresolved Critical Item Age** — age relative to consequence/deadline;
- **Time to Required Human Action** — from canonical condition to successfully actionable delivery.

False negatives are weighted by consequence. Do not average a missed high-impact approval/security condition away with many correctly suppressed low-value updates.

No single attention score is a release oracle. Use the metric portfolio to find failure modes and make explicit trade-offs between interruption burden and missed material action.


# 12. Interruption and delivery policy

Notifications are delivery receipts for canonical state, not the state itself. Extend the existing SaaS notification/preferences domain rather than inventing a notification control plane.

```text
NO ACTION / LOW VALUE
→ silent history only

USEFUL UPDATE
→ digest / Home

ACTION NEEDED
→ Needs You + optional channel notification

URGENT MATERIAL ACTION
→ immediate approved channel

SECURITY / ACCOUNT SAFETY
→ mandatory channel(s) according to security policy
```

## 12.1 Required routing inputs

- user/responsible owner;
- consequence/severity;
- deadline;
- whether blocking autonomous work;
- notification category;
- user quiet hours/timezone;
- company policy;
- preferred channel;
- dedupe/grouping key.

## 12.2 Anti-spam invariants

Batch repeated background success. Dedupe repeated fault symptoms. Never allow an agent to bypass routing by directly emailing/pinging a human except through an explicitly authorized communication tool.

# 13. Activation architecture — one onboarding system

Converge `SaasWelcome`, `OnboardingWizard`, `SetupWizard`, onboarding seed and Foundation Bootstrap into one activation architecture. UI variants may remain temporarily during migration, but one durable onboarding run owns progress. Reuse `company_onboarding_runs`; do not create a competing onboarding source of truth.

## 13.1 Target activation state

```text
ACCOUNT_READY
→ ORGANIZATION_CREATED
→ INTENT_CAPTURED
→ DISCOVERY_DRAFT_READY
→ MATERIAL_FACTS_CONFIRMED
→ FIRST_CAPABILITY_SELECTED
→ REQUIRED_ACCESS_READY
→ FIRST_SAFE_OUTCOME_STARTED
→ FIRST_USEFUL_OUTCOME_VERIFIED
→ ACTIVATED
→ EXPANSION (optional apps/team/hosting)
```

## 13.2 Activation principle

The customer should not need to understand runtime cells, model providers, Role Packs, Skills, cognitive providers, sandbox policy or orchestration before first value. These remain admin/expert concerns.

# 14. Onboarding customer journey

```text
1. Sign up
2. Create company (name + optional website/domain)
3. "What would you like August Works to help with first?"
4. AW builds/extends a draft Foundation from permitted/public/customer-provided evidence
5. Ask only material questions that change first capability/readiness
6. Recommend one first Agent Package / capability
7. Explain what it can do, needs access to, and asks before
8. Connect only the systems required for the selected first outcome
9. Run one safe, useful job
10. Show verified outcome + why it is trustworthy
11. Offer Slack/Teams, more apps, teammates, specialist agents and capacity expansion
```

Payment/plan selection must not be a mandatory early step for the Free Core path. Commercial prompts happen only when the user requests a paid capability/capacity or reaches a transparent resource boundary.

**V3 implementation lock:** the exact default activation shell, screen sequence, fields, actions, recovery, accessibility and copy are specified in §78. The 12-screen sequence is an August Works HOUSE default derived from the principles above; it is not claimed as a universal onboarding law.

# 15. Company discovery and Foundation bootstrap UX

V7 Foundation Bootstrap/Readiness remain the engines. V9 changes the presentation from `configure knowledge system` to `help us understand your company`.

## 15.1 Evidence presentation

Show candidate facts with human language and compact source cues. Ask confirmation only for facts that materially affect the requested outcome, authority or risk.

```text
We found:
Primary customer: Danish manufacturing SMEs
Source: approved website + CRM sample
Confidence/evidence: sufficient for internal drafting

Is this correct?
[Yes] [Change]
```

## 15.2 No questionnaire tax

Do not require customers to fill the complete Foundation taxonomy before useful work. Missing sections become ongoing quality findings and contextual questions.


## 15.3 Untrusted discovery ingestion contract

Public websites, uploaded documents, email/CRM samples and other external material used for discovery/Foundation bootstrap are **untrusted data**. Their text is never instruction, authority or policy.

Required path:

```text
permitted source
→ bounded fetch/read
→ content-type / size / malware-active-content policy
→ sanitize + normalize
→ preserve source/provenance
→ isolate from system/developer/control instructions
→ extract candidate facts
→ deterministic access/policy checks
→ corroborate / uncertainty-tag where material
→ human confirmation when consequence requires
→ typed Foundation proposal
→ canonical validation + governed commit
```

### Untrusted content MUST NOT

- widen a tool, connector or data permission;
- change system/developer/control instructions;
- authorize a user/agent action;
- disable a safeguard or approval;
- create/reveal credentials or secrets;
- directly commit Foundation truth;
- instruct Maintenance Autopilot;
- select a more privileged runtime/tool path;
- override tenant/company scope;
- turn a quoted instruction into an executable instruction merely because a model found it.

### Provenance

Every material bootstrap fact/proposal must retain sufficient source identity and extraction evidence to support:

- customer confirmation/correction;
- later audit/re-evaluation;
- source deletion/expiry where required;
- prompt-injection/adversarial investigation;
- conflict resolution between sources.

### Verification

The V9 negative test corpus must include indirect prompt injection in public web pages, uploaded documents and connected-system content. Success means the content may influence **candidate facts** within authorized scope but cannot influence authority/control semantics.


# 16. First useful outcome

Activation completes only after an outcome—not merely creation of an account/agent. The first outcome must be safe, observable and representative of the value proposition.

Examples: research brief, internal draft, project summary, campaign audit, meeting follow-up plan. Avoid external sends/payments/destructive actions as the default first run.

## 16.1 First-value evidence

Record the canonical Task/run, selected context manifest, output/artifact, verification state and user correction/acceptance. `first_value_at` means a useful outcome was verified, not that a wizard reached its last step.

# 17. Free Core, compute and commercial friction

V9 preserves V7's principle: core safety/governance/product value is not paywalled. Payment follows capacity, managed infrastructure, maintained specialist capability or enterprise assurance.

## 17.1 Starter compute experiment

Evaluate a small AW-funded starter allowance only after V6/V7 hosting, abuse and cost gates are qualified. It may cover Foundation bootstrap and one bounded first-outcome path. It is an experiment, not a guaranteed permanent entitlement.

If starter compute is unavailable, onboarding must still support BYOK/BYO runtime without making provider configuration feel like the product's core value proposition.

## 17.2 Upgrade UX

Never interrupt onboarding with generic plan comparison before value. Upgrade prompts must state the concrete boundary: e.g. `Your included managed runtime capacity is used; connect your own runtime or add capacity.`

# 18. Hire-an-Agent experience

Agent Packages become the default customer-facing provisioning model. The customer hires a capability; AW configures the implementation.

```text
Growth Specialist

DOES
research, campaign planning, performance analysis, draft creation

NEEDS
Analytics + Ads + selected company knowledge

CAN DO AUTOMATICALLY
read, analyse, draft, create internal tasks

ASKS BEFORE
publishing, spending, external communication above policy

[Hire]
```

On Hire, AW resolves Role Pack, Skills, Playbooks, memory policy, Readiness, use case, sandbox/runtime, supervision and evals. Advanced configuration remains available to authorized admins.

**V3 implementation lock:** the complete Hire Agent flow, authority preview, safe test, activation receipt and agent lifecycle are specified in §79.

# 19. Custom agent and expert setup

Keep full custom agent creation for AI leads/technical teams, but move it behind `Advanced setup`. Never remove capability merely to make the product appear simpler.

## 19.1 Expert authoring must remain inspectable

Show effective Role Pack, selected Skills, tool permissions, memory scopes, runtime/provider, sandbox posture, supervision/verification policy and use-case governance. Provide defaults and diff-based editing.

**V3 implementation lock:** §79 defines the guided Custom Agent builder, customer labels, default-hidden technical choices, draft/live revision semantics and monitoring path. §80 defines the orchestration decision contract.

# 20. Ambient operating surfaces

Slack, Teams, email and AW Chat are first-class operating surfaces. They are adapters over the same canonical Work/Decision/Approval/Agent state.

## 20.1 Minimum channel capability

A supported work channel should progressively support: ask/status, create/assign task, answer agent question, approve/reject, correct output, stop work, receive result, connect/reconnect where host UI permits, and open deep links for complex expert review.

## 20.2 Channel parity is semantic, not visual

Slack does not need to reproduce the web UI. It must preserve identity, scope, action consequence, canonical object reference and approval semantics.

# 21. Universal Ask / Command layer

Evolve existing Cmd/Ctrl+K from navigation/search into a universal deterministic-first command surface.

```text
VISIBLE / DETERMINISTIC
Navigate
Search
Create Task
Open Agent
Open Project
Connect App

AI-ASSISTED WHEN SEMANTIC
Ask August
Create workflow from description
Draft Foundation change
Recommend agent
Explain blocker
Summarize project
```

Do not invoke an LLM when normal command parsing/search can satisfy the intent.

# 22. Conversation as an authoring surface

A user or authorized agent should be able to create platform objects through natural language, but conversation is an **authoring interface**, not an authority bypass.

## 22.1 Supported authoring targets

- Workflow draft;
- Routine draft;
- Agent/Agent Package installation draft;
- Task/project;
- Foundation change proposal;
- app connection intent;
- notification preference proposal;
- V8 experiment/decision/scenario drafts where enabled.

## 22.2 Required pattern

```text
conversation intent
→ resolve canonical target + current version
→ build typed draft/proposal
→ validate
→ show structured preview/diff
→ obtain required approval/publish action
→ canonical domain service commits
→ return receipt
```

The agent may never silently `publish_workflow`, broaden permissions, change canonical Foundation or install a materially broader package unless existing policy explicitly authorizes that exact class of change.

# 23. Chat-native Workflow Builder

V4 already defines governed AI workflow authoring. V9 makes it customer-friendly.

```text
User: Every Monday, review HubSpot deals over 50k and ask me before outreach.

August Works:
Draft automation
Trigger: Monday 08:00
1. Read qualified deals
2. Research account
3. Sales Agent qualifies
4. If score > threshold → ask you
5. On approval → create outreach task

Permissions: HubSpot read
Writes: internal task only before approval
Estimated model calls: ...

[Test] [Edit] [Publish]
```

Use existing workflow revision/test/publish APIs. No invisible runtime plan replaces the explicit graph.

**V3 implementation lock:** §81 defines the full Describe → Draft → Review → Access → Approvals → Test → Inspect → Check → Publish → Operate → Change → Recover → Retire lifecycle and its customer-facing states.

# 24. Generative UI and Action Cards

V9 standardizes a bounded component vocabulary for AI interactions. Agents choose typed components; clients render them. Arbitrary agent-generated React/HTML is prohibited except through separately sandboxed MCP Apps.

## 24.1 Initial component catalog

- `TaskCard`

- `ResultCard`

- `ApprovalCard`

- `DecisionCard`

- `QuestionForm`

- `AgentStatusCard`

- `ConnectionRequestCard`

- `PermissionPreviewCard`

- `WorkflowDraftCard`

- `FoundationChangeCard`

- `PackageHireCard`

- `ReadinessBlockerCard`

- `MetricInsightCard`

- `ProcessFindingCard`

- `ScenarioComparisonCard`

- `ExperimentResultCard`

- `MaintenanceReceiptCard`

- `IncidentCard`

## 24.2 Component contract

```text
component type
schema version
canonical resource refs
view state
human-readable summary
evidence/source summary
risk/consequence summary
actions[]
expected resource version
surface capabilities
```

Every action resolves server-side authorization at click/submit time.

# 25. Agent/UI protocol strategy

Do not replace AW's internal runtime/control plane with a frontend protocol. Adopt compatibility only where it reduces adapter maintenance.

| Candidate | Current status | V9 decision |
|---|---|---|

| assistant-ui | MIT; already installed | Primary AW web conversational rendering; expand Tool UI/action-card use. |

| AG-UI | MIT, active event-based agent↔UI protocol | Build optional boundary adapter/conformance spike; do not make internal source of truth. |

| A2UI | Apache-2.0; v0.9.1 current production, v1.0 candidate | Adopt declarative/pre-approved component-catalog concepts; keep compatibility seam; do not bind production to candidate v1.0. |

| MCP Apps | official stable 2026-01-26 MCP extension | Strong candidate for third-party rich tool UI in AW Chat; host support only behind sandbox/permission/security review. |

| MCP | already core tool boundary | Keep; MCP Apps must reuse Tool Gateway authorization rather than create app-side authority. |

| A2A | agent↔agent boundary | No UX authority; may carry work that later projects to user surfaces. |

# 26. MCP Apps host requirements

If implemented, the AW host MUST conform to the **current stable MCP Apps host security requirements (2026-01-26 at the V2 audit cutoff)** plus AW's stricter Tool Gateway, tenant, authorization, approval, privacy and audit controls. When the two differ, the stricter scoped control wins.

Minimum host contract:

- Apps run in a sandboxed iframe / isolated host context with least-privilege sandbox capabilities.
- Every UI→host / app-initiated JSON-RPC message is untrusted and schema/semantic validated.
- All tool calls pass through the same AW Tool Gateway and current tenant/company scope, grants, policy, approvals, rate/budget controls and audit as ordinary calls.
- No ambient authentication cookie, raw credential, bearer secret or hidden host capability is exposed to app JavaScript.
- App-declared external resources/connections are governed by explicit CSP/domain declarations; undeclared network/resource access is blocked by default.
- App-only tool visibility is scoped to the relevant MCP server/connection; an app cannot use app-only affordances to call arbitrary cross-server capabilities.
- UI resources have identity/version/hash evidence sufficient for audit and incident reconstruction.
- Content rendered inside the App does not make host-level authorization decisions.
- Host bridge messages cannot become authority tokens.
- Clipboard, download, navigation, file, camera/microphone or equivalent sensitive capabilities require an explicit product/security decision rather than broad default sandbox grants.
- Failure of the app/iframe must not corrupt canonical AW state or trap the user in an unrecoverable approval/action flow.
- Accessibility and keyboard/focus behavior remain part of host acceptance; sandboxing does not waive WCAG/customer usability requirements.

MCP Apps compatibility is an interoperability feature. It does not change V4–V8 canonical authority or permit a third-party UI to create its own source of truth.

# 27. AI feedback, correction and takeover

Every meaningful AI output should provide a proportional correction path. Microsoft HAX/Google PAIR principles become implementation requirements.

```text
OUTPUT
→ Accept / use
→ Edit / correct
→ Ask why / inspect sources
→ Retry / refine when appropriate
→ Stop / take over
→ Report problem
```

Corrections that should change future behavior enter existing Memory/Learning proposal flows. A thumbs-down alone must not silently rewrite production behavior.

V3 further separates tenant-local output correction from August Works product feedback. `Helpful` / `Needs work` may update tenant-local evaluation/learning signals according to existing governance, but raw AI output must not be exported to the August Works product team merely because the user voted. Product-team sharing uses the explicit §85 Product Feedback contract.

## 27.1 Reset

Where personalization/learning materially affects a user's experience, provide appropriate reset/revoke/correct controls with clear scope.

# 28. Trust, transparency and AI literacy UX

AI identity is explicit on first relevant interaction and remains discoverable. Do not anthropomorphize to the point of deceptive human impersonation.

## 28.1 Capability card

For each customer-facing Agent Package show: what it does, typical quality/limitations, connected data, permitted actions, approval boundaries, responsible owner and how to stop/correct it.

## 28.2 Contextual AI literacy

Implement short, role-appropriate guidance at actual decision points. Examples: `This is an AI-generated recommendation`, `This agent cannot send externally without approval`, `This conclusion uses CRM + approved Foundation`, `You can stop this run here`. Completion/acknowledgement may be recorded where customer compliance requires evidence, but avoid turning normal product use into training bureaucracy.

# 29. Permission and connection UX

Connections must be simple without becoming opaque. Ask for permissions at understandable need, describe purpose and scope, default to least privilege, and clearly separate read/write/financial/external communication/identity-admin capabilities.

```text
Connect Google Workspace
Needed now: Drive read access to /Sales
Not requested: Mail, Calendar, whole-drive write
Used by: Sales Researcher
Purpose: proposal research
[Connect]
```

Broad scopes require explicit explanation. A user convenience flow may not imply authorization from an OAuth consent screen alone; AW server policy remains authoritative.

# 30. Maintenance Autopilot

V9 productizes existing Core Stewards, recovery, drift detection and maintenance jobs into one principle: **normal maintenance should resolve itself when the repair is deterministic, authorized and safely verifiable**.

## 30.1 Maintenance classes

| Class | Example | Default |
|---|---|---|

| M0 Observe | health/readiness scan | automatic |

| M1 Deterministic repair | retry safe sync, rebuild derivative index, reconcile stale projection | automatic after hard preconditions |

| M2 Reversible low-risk change | unchanged-authority package update, bounded config repair | policy opt-in + automatic verification |

| M3 Material change | permission expansion, workflow behavior change, Foundation conflict | proposal/review |

| M4 High-impact/operator | security posture, destructive recovery, infra isolation downgrade | human/operator only |

## 30.2 Auto-maintenance contract

```text
precondition
+ authority check
+ idempotency key
+ bounded attempt / deadline / cost
+ execute
+ postcondition verify
+ durable receipt
+ reconcile ambiguous outcome
+ rollback/fallback/escalation
```

An automated maintenance action that cannot verify its postcondition is not successful.


## 30.3 Maintenance authority, concurrency and blast-radius hardening

The base auto-maintenance contract is necessary but not sufficient for production self-repair.

### A. Authoritative desired state

Drift detection MUST identify which state is authoritative. `different` does not imply which side should be copied over the other. A repair must name the desired-state owner or deterministic derivation rule.

### B. Concurrency / stale-writer protection

For a resource that can be repaired or mutated concurrently, use the strongest practical control required by the domain:

- expected resource/version guard / compare-and-set;
- transaction/row lock where local serialization is the correct mechanism;
- lease with expiry where temporary ownership is required;
- fencing token / monotonic generation where a stale owner can resume and create harm;
- idempotency/effect key for duplicate-prone business effects.

An expired lease without stale-owner protection is not sufficient when the former holder can still write.

### C. Kill and revocation path

For `M2+` automated maintenance there must be a deterministic stop/revocation path outside the model/agent decision loop. Where platform-wide blast radius is credible, provide a domain/global disable mechanism with authorization and audit.

### D. Blast-radius budget

Policy must bound how much one maintenance decision can affect by tenant/company, resource count, value/cost, external side effects and time window. Bulk repair is a distinct risk class, not a loop over a safe single-resource action.

### E. Repair-loop breaker

Repeated:

```text
detect → repair → verify → drift again
```

must not execute indefinitely. After bounded repeated recurrence, quarantine/pause the repair class, retain evidence and escalate to the appropriate owner.

### F. State-compatible recovery

`rollback` is not the generic failure answer. A failed maintenance action explicitly chooses among:

- revert compatible code/config;
- roll forward;
- restore/reconstruct state;
- compensate an external effect;
- pause/drain while preserving the current valid state;
- operator/manual recovery.

### G. Ambiguous outcome

If the executor cannot prove whether an external/material effect occurred, classify the result as `INCONCLUSIVE / UNKNOWN_OUTCOME`, reconcile against authoritative external/canonical state, and do not blindly retry a harmful effect.

Successful self-repair therefore means:

```text
authorized
+ current-enough
+ concurrency-safe
+ bounded
+ executed
+ postcondition verified
+ externally/canonically reconciled where required
+ receipt retained
```


# 31. Maintenance domains

- Connection health, expired OAuth and safe re-auth requests

- Memory index/derived projection refresh and deletion propagation

- Readiness re-assessment on source/version changes

- Skill/Playbook/package revalidation after dependencies change

- Low-risk Agent Package updates already covered by V7 policy

- Workflow/routine stalled-run recovery and safe retry

- Provider capability/conformance drift detection

- Sandbox qualification expiry/revalidation

- Runtime orphan/reconciliation once V6/V7 physical hosting gates are qualified

- Backups/restore verification and retention jobs

- Notification delivery retries/dedupe

- Status-card background refresh budgets

- Cleanup of temporary/expired state according to retention policy

Each remains owned by its current domain; Maintenance Autopilot is policy/visibility over those owners, not a generic repair daemon with unrestricted writes.

# 32. Customer maintenance experience

Most successful repairs should not interrupt the customer. Preserve a compact maintenance history with a human-readable receipt. Interrupt only when customer authority/input is needed, risk increased, or automatic repair failed/exhausted budget.

```text
Reconnected automatically
HubSpot sync recovered after a temporary provider error.
No action needed.

or

Needs you
Google Ads authorization expired.
Growth Specialist can continue analysis but cannot update campaigns.
[Reconnect]
```

# 33. Low-toil platform operations

V9 also targets August Works operator toil. Product growth must not create one-off configuration per customer. Reuse V6's unified SaaS onboarding/operations model, provider-neutral adapters, deployment records and runtime fleet controls.

## 33.1 Toil metrics

Track: operator interventions per active company, customer support minutes, runtime manual repair count, failed auto-repair count, repeated incident class, one-off tenant configuration count and time-to-recover. Avoid universal thresholds until baseline data exists.

# 34. Support and service recovery

Support must be a recovery path, not the normal product interface. Build contextual diagnostics so users can understand and recover common failures without support.

**Product feedback is separate from support.** A user who wants to report a bug, suggest an improvement or propose an idea uses the global Customer Feedback flow in §85. A user who needs the current problem fixed now uses Support/self-service recovery. Security/privacy vulnerabilities use the dedicated secure security/privacy reporting path. The product MUST make these destinations explicit rather than asking customers to classify internal teams.

## 34.1 In-product support assistant

A support agent may explain current safe metadata, status, known limitations and documented recovery steps. It must not invent platform state. Any privileged support session uses V6's explicit support-session approval/scoping/audit model.

## 34.2 Report issue

Allow users to submit a problem with a redacted diagnostic bundle: route, deployment ID, resource refs, error code, recent safe events, browser/device metadata. Never attach secrets or raw confidential conversation by default.

# 35. Premium August Works design system

V9 does not replace the component stack. It creates one coherent August Works visual/interaction grammar on existing primitives.

## 35.1 Visual thesis

```text
QUIET
PRECISE
WARM
CONFIDENT
HIGH-CRAFT
TRUSTWORTHY
SLIGHTLY EDITORIAL WHERE APPROPRIATE
```

## 35.2 Premium rules

- hierarchy before decoration;
- whitespace as structure;
- fewer semantic surfaces/cards;
- restrained border/shadow/elevation;
- strong type scale and reading rhythm;
- one controlled accent language;
- consistent icon grammar;
- confidence through clarity, not hard-sell treatment;
- charts/data use accessible semantic color, not rainbow decoration;
- no generic purple-gradient/glow/robot/sparkle AI aesthetic as default;
- dark mode recomposes luminance/elevation rather than simply inverting colors.

## 35.3 Existing primitives

Base UI is preferred for new complex unstyled primitives where it reduces custom accessibility work. Existing Radix primitives remain. No big-bang migration is justified.

# 36. Design-system implementation

Use Storybook as the living component/interaction catalog. Create stories for every state—not just happy path.

```text
DEFAULT
HOVER / ACTIVE / FOCUS
LOADING
EMPTY
PARTIAL
STALE
DISABLED
PERMISSION-DENIED
ERROR
RECOVERING
SUCCESS
LONG CONTENT
LOCALIZED LONG TEXT
DARK
REDUCED MOTION
KEYBOARD
```

Centralize semantic tokens for color, typography, spacing, radii, elevation and motion. Do not tokenize one-off values that carry no reusable decision.

# 37. Legacy/UI convergence

V9 should retire duplicate UI paths progressively. Current streamlined UI is already default and production sidebar code documents classic mode as reference.

## 37.1 Migration

```text
INVENTORY duplicate/legacy surfaces
→ choose canonical customer surface
→ add parity tests + route/deep-link redirects
→ migrate callers
→ observe usage/support for deprecation window
→ remove legacy component/flag
→ remove dead CSS/API branches
```

Candidates include `.production` variants, legacy shell paths, duplicate onboarding flows and domain pages that move behind Advanced/Insights. Deletion happens only after semantic/accessibility parity, not for aesthetic cleanup alone.

# 38. Accessibility baseline

All customer-facing V9 surfaces target WCAG 2.2 AA regardless of whether a specific deployment is legally in EAA scope. Track EN 301 549 v4.1.1 as the future-facing European ICT standard while monitoring Official Journal harmonization.

## 38.1 Required test dimensions

- keyboard-only critical journeys;
- focus order/visible/not obscured;
- target size;
- no color-only meaning;
- labels/names/descriptions;
- accessible authentication;
- screen-reader smoke on critical flows;
- 200%/400% zoom/reflow where applicable;
- reduced motion;
- drag alternatives;
- charts with text/table equivalents;
- generative/action-card component catalog;
- Slack/Teams native accessibility semantics where controlled.

Automated axe/Storybook checks are first-line evidence, not sufficient conformance proof.

**V3 implementation lock:** §84 specializes this baseline into component/screen-level keyboard, focus, target-size, authentication, dialog, status-message, zoom/reflow and assistive-technology rules, including the global feedback experience.

# 39. Localization and international readiness

i18next already exists. V9 makes localization correctness a feature requirement. New customer copy must use translation keys, locale-aware dates/numbers/currency, flexible layouts and no string concatenation that breaks grammar.

Do not promise every locale/RTL at launch; ensure architecture and component states do not make expansion prohibitively expensive. AI-generated company content may remain in the company's working language. System/security/legal labels use reviewed translations.

# 40. Responsive and device behavior

Desktop remains the deepest admin surface, but ordinary member actions must work on narrow/mobile layouts: review Needs You, answer agent question, approve/reject where permitted, stop work, inspect result and continue chat.

Do not reduce mobile goals; reduce secondary information and use full-screen task flows where necessary.

# 41. Performance and perceived responsiveness

V9 treats responsiveness as part of usability. Establish measured budgets per critical journey rather than one arbitrary universal bundle target.

## 41.1 Frontend actions

- route-level lazy-load advanced/admin domains;
- avoid loading hidden feature data before surface need;
- preserve existing event-driven updates instead of reintroducing polling;
- virtualize/incrementally render long feeds;
- coalesce background queries across tabs;
- optimistic UI only when canonical conflict/recovery semantics are safe;
- prefetch only high-probability next views;
- ensure long-lived sessions do not grow memory unbounded.

## 41.2 Background operations

Show truthful progress stages. Never display fake percent completion for unknown-duration agent work. Preserve ability to leave the page while durable work continues.

# 42. Information architecture details

The default IA must be tested through card sorting/tree testing/usability tasks where appropriate. The reference grouping is intentionally outcome-oriented.

## 42.1 Reference shell

```text
Home
Needs You
Work
Agents
Insights       (role/context dependent)
Apps

Company menu / Settings
  Company knowledge / Foundation
  People & access
  Trust & Governance
  Billing & capacity
  Advanced
```

## 42.2 Advanced

Authorized experts can access Role Packs, Skills, Playbooks, provider/runtime details, cognitive providers, sandbox/conformance, security export, audit, experimental flags and low-level workflow/runtime tools. Search/command may expose authorized hidden destinations without adding them to permanent navigation.

# 43. Customer-facing terminology

Prefer outcome language over implementation names. Exact copy must be tested, but V9 adopts these translation rules:

| Internal concept | Default customer treatment |
|---|---|

| Readiness Engine | Explain the missing requirement in context; aggregate under Company health/Needs You. |

| Cognitive provider | Advanced/internal; no ordinary-user navigation. |

| Derived intelligence | Insights/learning output, not provider jargon. |

| Orchestration plan | Agent work plan / work in progress unless expert detail requested. |

| Role Pack | Agent configuration/role; hidden for package users. |

| Automation Artifact | Implementation detail under automation/workflow. |

| Work Signals | Background coordination signal; show the resulting task/question/follow-up. |

| Sandbox qualification | Security/runtime posture under Advanced/Trust. |

| Foundation | May remain branded canonical concept, but context labels should explain it as company knowledge/operating foundation. |

# 44. Agent status and explainability

Ordinary status is outcome-based. Avoid streaming every internal model/tool event into customer UI by default.

```text
Working on competitor analysis
Waiting for HubSpot
Needs your approval
Verifying result
Completed
Blocked — connection expired
```

Advanced trace remains available with tool/evidence/audit receipts. Hidden chain-of-thought is never surfaced or stored as explanation.

# 45. Proactive AI behavior

Agents may proactively surface information only through V9 attention/delivery policy. Proactivity must satisfy relevance, authority, bounded frequency and user/company preference.

Proactive suggestions are drafts/proposals unless the underlying action class is already authorized for automation.

# 46. Product analytics and UX evidence

V9 introduces an experience measurement schema, not another business-event source of truth. Store privacy-minimized event metadata or project canonical domain events into an optional analytics provider. Raw prompts/company content are excluded by default.

## 46.1 Core experience metrics

| Metric | Meaning |
|---|---|

| Time to First Useful Outcome | time from usable account/org to verified first useful result |

| Required Setup Actions Before Value | customer actions before first value |

| Self-Service Activation Rate | activation without human support |

| Background Completion Rate | successful outcomes without AW app visit during execution |

| Human Interruptions per Successful Outcome | attention cost |

| Actionable Attention Precision | share of surfaced items that were genuinely useful/actionable |

| Correction Rate | outputs requiring substantive user correction |

| Recovery Without Support | customer-resolved failures without support session |

| Customer Maintenance Minutes | estimated/observed monthly upkeep time |

| Auto-Repair Success | verified maintenance repairs / eligible repair attempts |

| Support Minutes per Active Company | operator/customer support burden |

| Core Task Success / Effort / Confidence | usability in ISO 9241-11 terms |

| Accessibility Critical Failure Count | must be zero for launch-critical journeys |

Do not set arbitrary numerical targets before baseline/pilot data. Define guardrails and target ranges after measurement.


## 46.2 Experience Analytics Data Processing Contract

Experience analytics is a privacy/data product surface and must earn its data. Provider convenience is not a processing purpose.

Every material event family SHOULD make the following contract recoverable:

```yaml
event_family:
owner:
decision_or_product_purpose:
allowed_fields: []
prohibited_fields: []
identity_granularity:
tenant_company_scope:
data_classification:
collection_source:
processor_or_sink:
processing_region:
access_policy:
sampling:
retention_trigger:
retention_rule:
deletion_and_rights_behavior:
backup_or_export_behavior:
redaction_or_hashing:
tests: []
review_triggers: []
```

### Collection model

- Prefer a server-side/shared event schema with explicit allow-listed fields.
- Raw prompts, raw model completions, document bodies, secrets, tokens, credentials and arbitrary company content are prohibited in generic product analytics by default.
- A new field does not inherit permission merely because the containing event is already approved.
- Free-form error strings are not automatically safe analytics fields; use classified/structured error codes and separately governed diagnostics where practical.
- Audit/security evidence, operational observability and product analytics are different purposes and SHOULD remain logically separable even if infrastructure overlaps.
- Event identity/granularity must be the minimum needed for the stated decision.

### Provider/residency rule

A provider's advertised EU region or storage location is one privacy/architecture input, not proof that every network hop, support path, subprocess, backup, derived dataset or contractual obligation satisfies a customer's residency/compliance requirement. Evaluate the actual scoped service and DPA/subprocessor/transfer architecture.

### Session replay

Session replay remains disabled by default for authenticated/sensitive company surfaces. Enabling it requires a separate purpose, masking/redaction assessment, access policy, retention, processor/DPA review, representative leakage testing and any required notice/choice/legal analysis.

### Verification

Test telemetry for:

- raw secret/token leakage;
- personal/company confidential data leakage;
- cross-tenant identifiers/content;
- deletion/retention behavior;
- sampling correctness;
- event-schema drift;
- provider/export failure;
- unexpected free-text capture.

Analytics acceptance evidence is part of the privacy assurance package, not merely dashboard verification.


# 47. Analytics provider strategy

Do not self-host a product analytics stack merely because it is open source; that conflicts with low-maintenance goals.

PostHog has an open-source core/FOSS option and EU cloud, and can provide product analytics/session replay/flags/experiments. V9 may add an optional provider adapter after DPA/subprocessor/privacy review. Prefer event analytics first. Session replay is disabled by default for sensitive authenticated company surfaces unless masking, consent/legal basis and retention have been explicitly approved.

GrowthBook is open core with much MIT code, but V8 experimentation and AW feature flags already own those domains. Do not add GrowthBook unless a concrete experimentation gap remains.

# 48. Usability research and validation program

V9 cannot be declared complete from design review alone. Run representative task-based usability studies and behavioral telemetry. Qualitative studies find problems; they do not establish population rates.

## 48.1 Representative roles

- founder/owner of a small business;
- manager/operations lead;
- ordinary employee primarily using Slack/Teams;
- AI/technical lead;
- enterprise security/IT administrator.

## 48.2 Critical usability journeys

1. signup → organization → first useful result

2. hire specialist agent

3. connect one required app with correct scope

4. ask agent in Slack/Teams and receive outcome

5. approve/reject a material action

6. correct an agent result and understand future effect

7. create a workflow through chat → test → publish

8. recover from expired connection

9. understand why an agent is blocked

10. stop autonomous work

11. manager reviews business risk/insight and creates decision/task

12. admin restricts an agent permission

13. downgrade to Free without losing core data/governance

14. keyboard/screen-reader completion of critical web journeys


## 48.3 Exploratory baseline → pre-registered formal validation

V9 separates discovery/pilot learning from confirmatory release evidence.

```text
EXPLORATORY BASELINE
→ discover failure modes / distributions / workflow reality
→ define final target roles + representative conditions
→ freeze material acceptance claims and oracles
→ pre-register PASS / FAIL / INCONCLUSIVE rules
→ execute formal validation
→ independent challenge where consequence warrants
→ release / hold / remediate
```

Do not choose an acceptance threshold after seeing the confirmatory result.

For every launch-critical journey, the formal validation record includes:

```yaml
journey_id:
target_role_population:
context_and_surface:
intended_outcome:
unacceptable_failures: []
task_success_oracle:
criticality:
required_security_privacy_conditions: []
required_accessibility_conditions: []
effort_confidence_measures: []
pass_rule:
fail_rule:
inconclusive_rule:
sample_or_repetition_rationale:
critical_slices: []
evidence_margin_or_uncertainty:
independence_required:
waiver_owner_if_any:
production_monitoring_follow_up:
```

Exact numeric targets are not invented before baseline evidence exists, but **the confirmatory rule is frozen before the confirmatory run**.

For material AI-mediated journeys, the evaluation portfolio SHOULD triangulate:

- model/system testing;
- adversarial/red-team testing;
- representative user/task testing;

and continue with post-deployment monitoring because controlled pre-release testing cannot represent every real-world dynamic, provider/model change or non-deterministic behavior.


# 49. Human-AI experience evals

Add evals beyond model output quality:

- correct surface/timing selection;
- correct action-card type;
- no missing consequence disclosure;
- uncertain intent asks clarification;
- easy dismissal/correction;
- no unauthorized mutation from chat;
- explanation references authorized evidence;
- notification spam/duplicate rejection;
- generated UI schema compliance;
- cross-surface canonical-state consistency;
- channel rendering degradation preserves semantics.


## 49.1 Human-AI release eval portfolio

For `C2+` AI-mediated experience behavior, a single aggregate model-quality score is insufficient.

The retained eval package should cover where relevant:

```text
CAPABILITY / TASK QUALITY
SAFETY / POLICY
AUTHORIZATION / TOOL USE
INDIRECT PROMPT INJECTION
PRIVACY / DATA BOUNDARIES
GENERATED UI / ACTION DISCLOSURE
UNCERTAINTY / ABSTENTION / CLARIFICATION
HUMAN OVERSIGHT / TAKEOVER
CROSS-SURFACE SEMANTIC CONSISTENCY
FAILURE / PROVIDER UNAVAILABILITY
COST / LATENCY / RETRY BOUNDS
CRITICAL ROLE / DATA / LANGUAGE SLICES
```

The same model/system SHOULD NOT be the sole producer and sole high-consequence judge of its own output. Use deterministic validators, independent systems/models, domain evidence or competent humans as appropriate to the claim.

Every behavior-affecting material AI change—model, prompt, retrieval/index, policy, tool, route, decoding/configuration or provider behavior—must identify which prior evidence remains valid and which evals require re-run.


# 50. Privacy, security and deceptive-design protections

V9 simplicity cannot become opaque data/authority expansion.

## 50.1 Privacy-by-default

Default data scopes should be the minimum needed for selected value. Analytics and feedback collection must have explicit purpose/retention. No raw conversation/session content in generic product analytics.

## 50.2 No dark patterns

Do not hide free paths, downgrade, delete/export, permission consequences or cost behind visually weaker or confusing choices. Do not preselect broader data sharing merely to improve activation.

## 50.3 AI transparency

When a person directly interacts with AI, clearly identify the AI nature as required by applicable AI Act transparency rules. Agent cards must not imply a human employee identity.

# 51. Enterprise UX

Enterprise controls should be discoverable to admins without dominating ordinary member UX.

Enterprise/admin surface includes: identity/SSO/SCIM, roles/access, data location/portability, audit/security export, use-case governance, AI literacy evidence where configured, retention/deletion, supplier/provider posture, dedicated runtime/isolation and support.

No core safety/governance feature is hidden solely by pricing. Enterprise pays for operating envelope, integration, assurance and contractual commitments.

**V3 implementation lock:** §82 defines the canonical Company/Settings information architecture and the contextual-governance rule that prevents governance from becoming first-value onboarding tax.

# 52. Data model changes — least-complex adequate

Prefer extending existing V6/V7 records over new global systems.

## 52.1 Extend `company_onboarding_runs`

```text
activation_intent_key nullable text
activation_intent_json jsonb
first_value_status text
first_value_task_id uuid nullable
first_value_run_id uuid nullable
first_value_at timestamptz nullable
recommended_package_version_id uuid nullable
experience_version integer default 1
last_customer_visible_step text nullable
```

Use explicit checks/foreign keys where final schema ownership allows. `answers` may remain backward-compatible during migration; new critical state should become typed columns when semantics stabilize.

## 52.2 Extend notification preferences

```text
channel policy (in_app / email / slack / teams where bound)
cadence (immediate / digest / in_app_only)
quiet hours + timezone
non-security category preferences
```

Security notifications retain mandatory delivery rules defined by security policy. Do not make the UI preference an authorization/security override.

## 52.3 Experience preference

If current sidebar/profile preference tables cannot cleanly hold it, add a small `company_user_experience_preferences` record for presentation-only choices such as `advanced_mode`, density and default home preference. Never store authorization there.

## 52.4 No global maintenance table by default

Maintenance receipts remain in owning domains + Activity Log. Add a global maintenance table only if cross-domain querying cannot be satisfied economically/reliably by projection.

# 53. Shared TypeScript experience contracts

```text
ExperienceContext {
  companyId
  actor
  surface
  experienceProfile
  currentObjectRef?
  locale
  timezone
  reducedMotion
  capabilities
}

ExperienceCard {
  id
  type
  schemaVersion
  canonicalRefs[]
  title
  summary
  severity
  evidenceSummary?
  consequenceSummary?
  actions[]
  staleAt?
}

ExperienceAction {
  id
  label
  domain
  operation
  targetRef
  expectedVersion?
  riskClass
  confirmationMode
}
```

Contracts live in `packages/shared`; Zod validators mirror them.

# 54. Experience APIs

Exact paths can follow repo conventions. Suggested:

```text
GET  /companies/:id/experience/home
GET  /companies/:id/experience/capabilities
POST /companies/:id/experience/command/preview
POST /companies/:id/experience/command/execute
GET  /companies/:id/experience/preferences
PATCH /companies/:id/experience/preferences

GET/PATCH existing onboarding run through V6 SaaS API
GET existing attention/Needs You feed
GET/PATCH existing notification preferences
```

`command/execute` is a facade/router only; it delegates to canonical domain services and never introduces a generic unrestricted mutation API.

# 55. Experience state machines

## 55.1 Activation

```text
new
→ organization_created
→ intent_captured
→ discovering
→ needs_material_input | capability_ready
→ access_needed | first_outcome_ready
→ first_outcome_running
→ first_outcome_verified
→ activated

Any nonterminal state → abandoned/resumable
```

## 55.2 Attention delivery

```text
canonical condition
→ projected attention item
→ routed (silent/digest/immediate)
→ delivered
→ resolved | snoozed | dismissed | expired
```

## 55.3 Maintenance

```text
detected
→ eligible_check
→ blocked | scheduled
→ running
→ verifying
→ repaired | inconclusive | failed
→ silent receipt | digest | needs_user | needs_operator
```

# 56. Authorization invariants

- Experience profile never grants domain permission.

- Hidden navigation does not make a route inaccessible; server authorization does.

- Chat authoring cannot bypass approval/publish flows.

- Generated UI action IDs are not authority tokens.

- MCP Apps/A2UI/AG-UI messages are untrusted client input until canonical authorization.

- Cross-company actions preserve local presence/scope and explicit cross-company purpose.

- Notification delivery cannot expose data the recipient cannot read at delivery time.

- Stale action cards cannot mutate newer canonical versions without conflict handling.

# 57. Failure and recovery UX

For every critical journey define empty/loading/partial/stale/offline/denied/error/recovering states. Preserve user input across recoverable errors and scope changes where safe.

Errors should answer: what happened, whether work/data is safe, what AW is doing, what the user can do, and how to retry/leave.

# 58. Open-source reuse decision matrix

| Area | Candidate | V9 decision | Reason |
|---|---|---|---|

| Conversational UI | assistant-ui (MIT) | USE/EXTEND | Already installed; Tool UI supports typed loading/result/error/input states. |

| Agent↔UI events | AG-UI (MIT) | EVALUATE ADAPTER | Can reduce framework-specific frontend wiring; do not replace internal state. |

| Declarative generative UI | A2UI (Apache-2.0) | ADOPT PATTERNS/COMPATIBILITY | Pre-approved components and non-executable declarations fit AW security; v1.0 is candidate. |

| Third-party tool UI | MCP Apps stable extension | EVALUATE / likely adopt host support | Official interoperable rich UI with sandbox/audit model; reuses MCP boundary. |

| UI primitives | Base UI (MIT) | USE FOR NEW COMPLEX PRIMITIVES | Unstyled accessible primitives already dependency. |

| Existing primitives | Radix (MIT) | KEEP | No value in big-bang migration. |

| Command menu | cmdk | KEEP/EXTEND | Already implemented. |

| Server state | TanStack Query | KEEP | Existing canonical web client pattern. |

| Workflow graph | XYFlow | KEEP | Already V4 decision. |

| Component QA | Storybook + a11y | KEEP/EXPAND | Already installed. |

| Browser E2E | Playwright | KEEP/EXPAND | Critical journey evidence. |

| Localization | i18next | KEEP | Already installed. |

| Product analytics | PostHog | OPTIONAL MANAGED ADAPTER | Useful event analytics; self-hosting adds ops. Review DPA/region/retention. |

| Experimentation | GrowthBook | DEFER | V8 experiments + existing flags already own this problem. |

| Support suite | Chatwoot/other | EXTERNAL OPTION ONLY | Do not embed another customer source of truth without proven need. |

## 58.1 Reuse gate

Any new dependency must pass: license, active maintenance, security model, data exposure, accessibility, bundle/runtime cost, migration/exit path, overlap with AW source of truth, and **net maintenance reduction**. Open source that creates a new operated platform fails the low-maintenance objective unless it removes more toil than it adds.

# 59. Feature flags and rollout

V9 flags protect migrations, not permanent product fragmentation. Suggested initial flags:

```text
experience_shell_v9
activation_v9
home_v9
needs_you_v9
ambient_commands_v9
agent_action_cards_v9
maintenance_autopilot_v9
mcp_apps_host_v9
ag_ui_adapter_v9
starter_compute_experiment_v9
customer_feedback_v9
experience_execution_v3
```

Each flag has explicit dependency graph and rollback semantics. Retire flags after stable migration and remove dead branches.


## 59.1 V9 Safe Change Program

Feature flags protect exposure; they do not by themselves prove migration safety.

Every material shell, onboarding, data-schema, notification, authorization-adjacent, analytics or source-of-truth convergence change requires a Safe Change Record proportionate to criticality.

Minimum record:

```yaml
change_id:
intent:
protected_invariants: []
old_authority:
new_authority:
mixed_version_states: []
expand_phase:
migration_or_backfill:
reconciliation:
cutover_authority:
contract_cleanup_phase:
irreversible_boundaries: []
observability_and_stop_signals: []
rollback_if_state_compatible:
roll_forward_or_compensation:
deep_link_api_channel_compatibility:
privacy_security_effect:
owner:
temporary_mechanisms_to_remove: []
flag_retirement_condition:
evidence_required_to_continue: []
```

### Mixed-version safety

For stateful/contract changes where old and new code/data can coexist, explicitly test relevant combinations rather than assuming schema compatibility implies semantic compatibility.

### Irreversibility ledger

Record when a step first makes an old code/configuration version unsafe, destroys old representation, sends an external effect, changes permissions, migrates credentials or otherwise removes a clean reverse path.

### Reconciliation

Backfill/migration success is not inferred only from job completion. Define reconciliation against authoritative facts, including count/value/invariant checks appropriate to the domain.

### Cleanup is part of migration

Temporary dual reads/writes, legacy flags, adapters, aliases, old routes and compatibility code have owners and explicit removal criteria. A migration is not complete while uncontrolled transitional complexity remains.


# 60. Implementation waves

| Wave | Scope | Exit |
|---|---|---|

| Wave 0 | Repo/UX/assurance/execution contract freeze | V9 ADRs; Security Assurance Map; C0–C4 mapping; Safe Change templates; V3 Screen Contracts; canonical navigation/onboarding/agent/workflow/settings/feedback journeys; baseline telemetry; formal-validation design; duplicate-surface inventory; no customer behavior change. |

| Wave 1 | Experience contracts | shared ExperienceContext/Card/Action contracts; projection service; authorization tests. |

| Wave 2 | Shell convergence | role/context progressive shell; advanced area; preserve deep links/routes. |

| Wave 3 | Home projection | Needs You/In Progress/Done/Watch/Ask; no new business state. |

| Wave 4 | Needs You convergence | productize WhatNeedsMe; unify decision/approval/blocker cards; attention precision telemetry. |

| Wave 5 | Notification routing | digest/immediate/quiet hours/channel policies over existing notification domain. |

| Wave 6 | Activation core | extend V6 onboarding run; intent-first state machine; remove early plan gate for Free Core path. |

| Wave 7 | Discovery + material questions | Foundation bootstrap/readiness customer UX; contextual questions only. |

| Wave 8 | First useful outcome | safe starter outcome, verification, first_value_at; resumable activation. |

| Wave 9 | Hire-an-Agent | customer package cards, one-click install path, advanced escape hatch. |

| Wave 10 | Ambient commands | Cmd+K Ask/Create/Run; deterministic-first router. |

| Wave 11 | Chat-native authoring | workflow/routine/foundation/agent drafts through existing governed APIs. |

| Wave 12 | Action-card system | assistant-ui typed component catalog across AW Chat; Slack/Teams semantic adapters. |

| Wave 13 | Protocol interoperability | AG-UI adapter spike; A2UI compatibility tests; no internal authority change. |

| Wave 14 | MCP Apps | sandboxed host support through Tool Gateway after security review. |

| Wave 15 | Maintenance Autopilot | policy tiers, desired-state authority, concurrency/fencing controls, blast-radius/kill/loop budgets, cross-domain maintenance projection, receipts, reconciliation and escalation. |

| Wave 16 | Support/recovery | self-service recovery, diagnostic bundle, V6 support-session integration. |

| Wave 17 | Design-system convergence | Storybook states, tokens, premium shell, duplicate component retirement. |

| Wave 18 | Accessibility/localization/performance | WCAG 2.2 AA evidence, i18n, responsive/mobile, route/bundle/perf fixes. |

| Wave 19 | Customer Feedback & Product Improvement | native feedback domain; persistent global trigger; contextual post-task entry points; My Feedback/status loop; privacy/security/a11y; internal triage; Paperclip Labs output-sharing migration. |

| Wave 20 | Experience analytics | purpose-bound Data Processing Contracts; allow-listed TTFO/effort/interruption/maintenance/feedback instrumentation; leakage/deletion tests; optional provider adapter. |

| Wave 21 | Exploratory usability pilots | representative customers/roles; establish baseline/failure modes; fix blockers; validate the exact V3 Screen Contracts; freeze confirmatory acceptance rules for IA/onboarding/agent/workflow/settings/feedback/attention journeys. |

| Wave 22 | Hosted end-to-end qualification | only after V6/V7 hosting gates: starter compute, managed agents, real channels/provider/runtime. |

| Wave 23 | GA assurance gate | pre-registered formal journey validation, security/adversarial evidence, accessibility review, performance/recovery, privacy/analytics/feedback evidence, support readiness, Safe Change closure, V3 no-guess coverage audit, trust/compliance UX and no unresolved launch-critical defect. |

# 61. Detailed PR plan

1. V9-001 ADR + architecture locks + Security Assurance Map + C0–C4 mapping + feature dependency map + Safe Change template

1. V9-002 experience shared types/validators

1. V9-003 Experience Orchestrator read model

1. V9-004 authorization/staleness + Experience Orchestrator degradation/freshness/resilience regression suite

1. V9-005 experience profile resolver

1. V9-006 progressive shell + Advanced entry

1. V9-007 sidebar route compatibility + deep-link tests

1. V9-008 legacy shell usage telemetry

1. V9-009 Home projection service

1. V9-010 Home UI / accessible empty/loading/failure states

1. V9-011 Needs You naming/IA migration over attention

1. V9-012 unified ActionCard renderer base

1. V9-013 attention precision + critical recall/miss/late/duplicate metrics + dismiss reason telemetry

1. V9-014 notification preference schema extension

1. V9-015 quiet hours/digest scheduler

1. V9-016 Slack/Teams/email delivery policy adapters

1. V9-017 notification privacy/redaction tests

1. V9-018 onboarding schema migration

1. V9-019 activation state machine/service

1. V9-020 intent capture UX

1. V9-021 discovery progress + source/provenance/evidence cards + untrusted-content boundary

1. V9-022 material-question resolver + indirect prompt-injection/ingestion policy tests

1. V9-023 activation resume/recovery

1. V9-024 Free Core onboarding commercial gate removal

1. V9-025 first-value task/run binding

1. V9-026 first-value verification + analytics

1. V9-027 first-outcome UI

1. V9-028 Agent Package customer catalog projection

1. V9-029 Hire Package simplified install flow

1. V9-030 package permissions/consequence preview

1. V9-031 advanced package/custom agent path

1. V9-032 Cmd+K intent router

1. V9-033 command palette Ask/Create/Run UI

1. V9-034 deterministic command catalog

1. V9-035 natural-language task/project authoring

1. V9-036 chat workflow draft adapter

1. V9-037 workflow preview/diff/test card

1. V9-038 chat Foundation proposal adapter

1. V9-039 chat agent/package proposal adapter

1. V9-040 chat connection intent adapter

1. V9-041 assistant-ui tool/action component registry

1. V9-042 approval/decision/question cards

1. V9-043 result/progress/recovery cards

1. V9-044 V8 insight cards contracts

1. V9-045 Slack block/modal action-card mapping

1. V9-046 Teams adaptive-card action mapping

1. V9-047 channel semantic parity tests

1. V9-048 AG-UI mapping/conformance spike

1. V9-049 A2UI compatibility/renderer experiment

1. V9-050 MCP Apps stable-spec conformance + AW security ADR

1. V9-051 MCP Apps sandboxed host PoC

1. V9-052 MCP Apps Tool Gateway authorization integration

1. V9-053 MCP Apps security/accessibility acceptance

1. V9-054 maintenance action classification + desired-state/concurrency model

1. V9-055 maintenance policy evaluator + fencing/version guards + blast-radius/kill/loop budgets

1. V9-056 Core Steward/readiness maintenance projection

1. V9-057 connector recovery/re-auth projection

1. V9-058 package/skill/playbook revalidation projection

1. V9-059 workflow/runtime recovery projection

1. V9-060 maintenance receipt UI/history

1. V9-061 maintenance escalation → Needs You

1. V9-062 maintenance cost/retry budgets

1. V9-063 support diagnostic bundle

1. V9-064 self-service error recovery cards

1. V9-065 V6 support session customer UX

1. V9-066 design token audit/consolidation

1. V9-067 Storybook V9 state matrix

1. V9-068 premium shell typography/layout refinement

1. V9-069 card/surface reduction pass

1. V9-070 motion/reduced-motion pass

1. V9-071 dark-mode recomposition audit

1. V9-072 `.production`/legacy parity inventory

1. V9-073 migrate canonical Agents/Skills/Costs surfaces

1. V9-074 retire redundant onboarding variants

1. V9-075 retire streamlined legacy flag after migration

1. V9-076 route-level lazy loading/performance pass

1. V9-077 long-session memory/render performance

1. V9-078 mobile critical action surface

1. V9-079 WCAG automated gates

1. V9-080 keyboard/screen-reader critical journey tests

1. V9-081 accessible auth/onboarding tests

1. V9-082 charts/generative UI nonvisual alternatives

1. V9-083 localization key migration for V9 surfaces

1. V9-084 Danish/English reference locale QA if launch scope requires

1. V9-085 UX event Data Processing Contracts + allow-listed schema/redaction/leakage tests

1. V9-086 Time-to-first-outcome funnel

1. V9-087 interruption/attention telemetry

1. V9-088 maintenance/support effort telemetry

1. V9-089 optional PostHog adapter + DPA/privacy feature gate

1. V9-090 onboarding exploratory usability pilot harness + confirmatory-validation preregistration

1. V9-091 Slack-only employee journey E2E

1. V9-092 manager decision/insight journey E2E

1. V9-093 AI admin advanced setup journey E2E

1. V9-094 failure/recovery + Orchestrator degradation + maintenance concurrency/ambiguous-outcome pilot

1. V9-095 hosted starter-compute experiment (only after V6/V7 gates)

1. V9-096 live managed-agent activation qualification

1. V9-097 live channel notification/approval qualification

1. V9-098 enterprise admin/accessibility qualification

1. V9-099 customer support readiness + runbook

1. V9-100 V2 assurance evidence baseline + legacy cleanup prerequisites


### V3 Experience Execution + Customer Feedback PR extension

PR identifiers are stable work-item IDs; **Wave dependency order, not numeric ID alone, governs execution**.

1. V9-101 Screen Contract schema + coverage manifest + CI completeness check

1. V9-102 canonical profile navigation + shell utility area (`Ask August`, `Feedback`, help/profile) + responsive adaptation

1. V9-103 onboarding execution screens ONB-01–ONB-04

1. V9-104 onboarding execution screens ONB-05–ONB-08 + just-in-time connection/permission contract

1. V9-105 onboarding execution screens ONB-09–ONB-12 + resume/recovery/accessibility

1. V9-106 Hire Agent flow + capability/access/authority/test/review/activation receipt

1. V9-107 Custom Agent builder steps 1–6 (outcome, identity, instructions, knowledge, tools, authority)

1. V9-108 Custom Agent builder steps 7–13 (memory, collaboration, runtime, test, review, publish, monitor) + draft/live lifecycle

1. V9-109 orchestration decision contract + bounded multi-agent admin projection + takeover/kill propagation

1. V9-110 workflow full lifecycle + plain-language-first review + safe test + immutable publish revision + recovery/retirement

1. V9-111 Company/Settings/Governance canonical IA + contextual governance + settings search/deep-link contracts

1. V9-112 global microcopy/form/confirmation/error/recovery/loading/success receipt standards + component/state QA

1. V9-113 enhanced accessibility targets + dialog/focus/live-status/zoom/touch/authentication critical-flow evidence

1. V9-114 Customer Feedback shared schema/domain/API + tenant/RBAC/privacy contract

1. V9-115 persistent global Feedback trigger + feedback dialog + session draft + confirmation receipt

1. V9-116 feedback safe-context collector + optional diagnostics + screenshot attachment pipeline + malware/privacy controls

1. V9-117 My Feedback status/follow-up UI + AW internal triage/dedupe/linking + notification loop

1. V9-118 migrate `OutputFeedbackButtons` away from Paperclip Labs sharing; tenant-local output feedback + explicit per-submission AW product-sharing path

1. V9-119 feedback security/a11y/privacy/E2E/usability suite + support/security destination tests

1. V9-120 V3 no-guess experience coverage audit + final security/AI/UX/accessibility/privacy/migration/feedback acceptance evidence + release-status decision


# 62. Acceptance journeys

V9 is not complete until these journeys pass with production-like data and real browser/channel semantics as applicable.

- signup → organization → first useful result.

- hire specialist agent.

- connect one required app with correct scope.

- ask agent in Slack/Teams and receive outcome.

- approve/reject a material action.

- correct an agent result and understand future effect.

- create a workflow through chat → test → publish.

- recover from expired connection.

- understand why an agent is blocked.

- stop autonomous work.

- manager reviews business risk/insight and creates decision/task.

- admin restricts an agent permission.

- downgrade to Free without losing core data/governance.

- keyboard/screen-reader completion of critical web journeys.

Additional: package update repaired in background without customer interruption; provider/connection drift escalates once with actionable wording; maintenance failure does not spam; hidden Advanced pages remain directly addressable for authorized admins; deep links survive shell migration.

Additional V2 assurance journeys:

- malicious public/uploaded discovery content cannot change control instructions, permission scope, tools or Foundation authority;
- stale/concurrent Maintenance worker cannot overwrite a newer authoritative state;
- repeated repair loop trips a breaker and escalates rather than operating indefinitely;
- ambiguous external maintenance outcome is reconciled before retry;
- Experience Home remains truthful under one/multiple dependency timeouts and marks stale/unavailable state;
- consequential action from a stale card/channel message fails closed or enters explicit conflict recovery;
- critical Needs You condition is delivered within its required action window and a deliberately suppressed critical condition is detected by recall/miss testing;
- analytics instrumentation rejects raw prompts/secrets/company-content fields that are outside the approved event contract;
- shell/onboarding/schema migration is rehearsed through mixed old/new states and reconciles before legacy authority is removed;
- MCP App undeclared/cross-server/unauthorized capability attempts fail closed through the host/Tool Gateway.

V3 execution/feedback journeys:

- customer completes the exact ONB-01 → ONB-12 activation path without exposure to runtime/model/internal-domain terminology;
- customer exits onboarding after organization creation and resumes at the first incomplete material step without data loss;
- customer hires a packaged agent through capability → missing access → authority → safe test → review → active receipt;
- AI Admin creates a Custom Agent using every required V3 builder stage, tests it, publishes a revision, edits a new draft while the active revision remains unchanged, then pauses/retires it;
- orchestration chooses deterministic workflow / single agent / manager-specialists / handoff / orchestrator-workers according to the §80 decision contract and exposes only appropriate depth to the current experience profile;
- workflow moves through draft → test → publish → run → change → recover/retire with no implicit live mutation;
- authorized admin locates every governance/security/privacy/audit setting through the §82 IA without backend-domain knowledge;
- any authenticated customer can open `Feedback` from any normal product surface in one direct interaction from the global shell utility;
- user submits Bug / Improvement / Idea / Other feedback, receives a durable feedback ID and can later view customer-safe status;
- feedback makes clear that urgent support and security/privacy reporting use different paths;
- `Don't include my name in this feedback` removes user identity from the product-feedback record while accurately explaining remaining company/technical context;
- optional technical diagnostics and attachments are never included without the relevant explicit user action and preview/disclosure;
- screen-reader/keyboard-only user opens, completes, submits and closes the feedback dialog and focus returns predictably;
- existing AI output `Helpful / Needs work` no longer sends or authorizes future raw output sharing to Paperclip Labs or August Works by implicit carried-forward preference.

# 63. Hard UX gates

**UX-GATE-01:** No launch-critical journey has an unresolved severity-1 usability defect.

**UX-GATE-02:** No customer-critical journey requires knowledge of an internal implementation concept unless the task is technical administration.

**UX-GATE-03:** Free Core onboarding can reach useful value without a forced plan-purchase step.

**UX-GATE-04:** First-value outcome is real/verified, not wizard completion.

**UX-GATE-05:** Every consequential AI action has a correction/stop/review path proportional to risk.

**UX-GATE-06:** Needs You does not duplicate canonical state and stale actions are rejected.

**UX-GATE-07:** Notification batching/dedupe/quiet-hours work and security exceptions are explicit.

**UX-GATE-08:** Customer permissions are shown at understandable need with purpose/scope.

**UX-GATE-09:** Chat-authored workflows/packages/Foundation changes use canonical proposal/publish gates.

**UX-GATE-10:** Maintenance Autopilot never broadens authority through repair.

**UX-GATE-11:** WCAG 2.2 AA automated + manual critical-journey evidence passes.

**UX-GATE-12:** Representative member/manager/admin usability tests complete core journeys with acceptable effectiveness/effort/confidence based on pilot evidence.

**UX-GATE-13:** Loading/error/recovery states preserve work where expected.

**UX-GATE-14:** No raw secrets/confidential prompts are sent to product analytics by default.

**UX-GATE-15:** Legacy shell/onboarding removal has migration/deep-link/regression evidence.

**UX-GATE-16:** MCP Apps/AG-UI/A2UI additions cannot bypass Tool Gateway or server auth.


**UX-GATE-17:** Every §65 security/abuse threat has an implemented prevention/detection/recovery disposition plus retained verification evidence; no launch-critical threat exists only as prose.

**UX-GATE-18:** Critical attention recall/miss/late evidence passes for defined material attention classes; high-consequence false negatives cannot be averaged away by high precision.

**UX-GATE-19:** Formal launch validation uses pre-registered `PASS / FAIL / INCONCLUSIVE` rules frozen after exploratory baseline and before the confirmatory run.

**UX-GATE-20:** Foundation/discovery ingestion treats external content as untrusted data; indirect prompt injection cannot widen authority, tools, permissions or canonical truth without governed proposal/commit.

**UX-GATE-21:** `M2+` Maintenance Autopilot actions demonstrate desired-state authority, concurrency/stale-writer safety, bounded blast radius, deterministic stop/revocation and state-compatible recovery.

**UX-GATE-22:** Experience Orchestrator dependency failure produces truthful partial/stale/unavailable state; consequential writes fail closed when required current authority/version/freshness cannot be established.

**UX-GATE-23:** Experience analytics event families have approved purpose/field/retention/access/deletion/test contracts and leakage tests; provider-region labels are not treated as compliance proof.

**UX-GATE-24:** Every material V9 migration has a Safe Change Record, representative mixed-version/reconciliation evidence where applicable, known irreversible boundaries, and a cleanup/flag-retirement condition.

**UX-GATE-25:** `C2+` AI-mediated critical journeys have a multi-method eval portfolio including relevant system/model testing, adversarial testing and representative user/task testing, plus post-deployment monitoring obligations.

**UX-GATE-26:** Security, privacy, accessibility, AI-eval, migration/recovery and usability evidence is attributable to the exact source/configuration/released artifact being approved.



**UX-GATE-27:** Every launch-critical customer-facing route/dialog/action card in the V3 coverage manifest has an approved Screen Contract; no material field/action/state/accessibility behavior is left to implementation-agent invention.

**UX-GATE-28:** The canonical ONB-01–ONB-12 activation path, including skip/back/save-exit/resume/error/recovery behavior, passes representative usability and accessibility evidence.

**UX-GATE-29:** Hire Agent, Custom Agent, orchestration and workflow flows implement the exact V3 lifecycle/authority/versioning contracts and do not expose technical choices to ordinary members unless the choice changes their decision.

**UX-GATE-30:** Company/Settings/Governance uses the canonical §82 IA; task-specific settings remain contextual and rare/technical controls remain progressively disclosed without hiding risk, cost, permission scope or current critical state.

**UX-GATE-31:** Global Feedback is reachable consistently from every authenticated product surface, is distinguishable from urgent Support and secure security/privacy reporting, and never blocks or interrupts the current task.

**UX-GATE-32:** Product feedback has a canonical AW source of truth and privacy-minimized safe-context contract; raw prompts, messages, files, tool payloads, DOM content and screenshots are not attached by default.

**UX-GATE-33:** Feedback submission returns a durable receipt/ID and customer-safe status; `Needs info` and resolution updates can close the loop without promising a response to every submission.

**UX-GATE-34:** Existing `OutputFeedbackButtons` Paperclip Labs sharing is removed/migrated. No prior Paperclip sharing preference is interpreted as consent to share content with August Works.

**UX-GATE-35:** Feedback dialog, attachments, status history and global trigger pass keyboard, screen-reader, zoom/reflow, target-size, focus-return, validation/error and mobile/narrow-surface acceptance tests.

**UX-GATE-36:** A V3 experience-spec coverage audit confirms that coding agents implement existing contracts rather than inventing new required steps, navigation, permission prompts, confirmation policy, customer terminology or autonomy semantics.


# 64. Hosting and production dependencies

V9 source/UI work can proceed while some V6/V7 hosting evidence remains open. However the following V9 claims cannot be earned locally:

- managed runtime zero-friction onboarding;
- AW starter compute;
- live provider/model first-value path;
- physical OpenShell/credential broker behavior;
- real Slack/Teams/email delivery at scale;
- managed auto-repair of hosted runtimes;
- production notification deliverability;
- real cost/abuse envelope;
- full hosted customer usability pilot.

These inherit V8's R0–R5 production-readiness stages and V6/V7 hard gates. V9 does not weaken them for UX convenience.

The three explicitly unresolved V7 implementation blocker groups remain named predecessor obligations and MUST stay closed until their own acceptance evidence passes:

```text
native_openshell_host_bridge
credential_use_broker_and_revocation
pre_spend_model_reservation
```

V9 also inherits the protected V7 integrated-pilot evidence set (35 journey/fault/compound/operating-evidence items) and the open V6 live-hosting/provider qualification track. A smoother onboarding screen, chat action or auto-repair experience is never evidence that these runtime controls are physically qualified.

# 65. Security / abuse threat scenarios

- Attacker uses natural-language command to smuggle privileged action into a benign workflow draft.

- Generated UI spoofs an approval or hides material arguments.

- MCP App attempts ambient credential/cookie access or cross-server tool call.

- Notification channel leaks task/confidential content to email/Slack recipient without current read authority.

- Agent spams a manager to socially engineer approval.

- Onboarding public-web content prompt-injects Foundation/bootstrap behavior.

- Starter compute is abused for mining/general inference rather than activation.

- Maintenance Autopilot mistakes attacker-created drift for a repair instruction.

- Role-based hidden UI is mistaken for authorization.

- Analytics/session replay captures secrets or sensitive personal/company data.

- AI-generated help fabricates a safe status and suppresses escalation.

Security tests must prove these fail closed or degrade safely.


## 65.1 Required security test disposition

For each scenario above, record:

```yaml
threat_id:
asset:
trust_boundary:
criticality:
attack_precondition:
protected_invariant:
preventive_controls: []
detective_controls: []
recovery_controls: []
automated_tests: []
manual_or_adversarial_tests: []
evidence_refs: []
residual_risk:
owner:
revalidation_trigger:
```

At minimum, V9 security testing spans:

- horizontal/cross-tenant access;
- stale/forged action cards and generated component payloads;
- natural-language privilege escalation;
- indirect prompt injection through discovery/retrieval/connected content;
- OAuth/connection scope confusion;
- approval spoofing/social engineering;
- notification/data exfiltration;
- MCP App host bridge/CSP/sandbox/cross-server abuse;
- analytics/telemetry secret and confidential-data capture;
- maintenance drift poisoning, stale-worker races and repair-loop abuse;
- rate/budget/resource exhaustion through agentic actions.

Security validation uses OWASP ASVS requirements where applicable to the web/application surface and product-specific agentic negative tests for controls that ordinary ASVS does not model.


# 66. V9 anti-patterns

- Do not measure success by time-in-app or number of clicks alone.

- Do not turn every backend domain into a sidebar item.

- Do not make an onboarding tour explain 30 features.

- Do not ask for data the system already has unless re-verification is material.

- Do not request broad permissions before the user understands the need.

- Do not force plan selection before Free Core value.

- Do not make users choose a model/runtime if a safe default/managed path is available and qualified.

- Do not treat invisible automation as automatically good UX.

- Do not hide risk, cost, irreversible actions or uncertainty behind progressive disclosure.

- Do not send one notification per agent event.

- Do not make chat a privileged backdoor around domain APIs.

- Do not generate arbitrary executable frontend code from the model.

- Do not copy Linear/Raycast/Apple aesthetics wholesale.

- Do not add a new design framework simply to obtain a different visual style.

- Do not self-host an OSS analytics/support product if doing so increases total toil without strategic value.

- Do not auto-repair when the postcondition cannot be verified.

- Do not silently adapt agent behavior in ways users cannot correct/reset/understand.

- Do not treat accessibility automation as complete accessibility testing.

- Do not delete legacy routes before deep-link/migration evidence exists.

# 67. Definition of Done

The governed V9 V3 implementation is complete only when all applicable items below are true and evidence is retained.

## 67.1 Activation

- one durable onboarding/activation model;

- intent-first path;

- material-question Foundation bootstrap;

- first useful verified outcome;

- resume/recovery;

- Free Core path without early paywall;

- optional expansion after value;

## 67.2 Daily experience

- Home projection;

- Needs You action queue;

- role/context progressive shell;

- Ask/Command layer;

- ordinary member can complete core work without navigating technical domains;

- manager can reach insights/decisions without analytics cockpit overload;

## 67.3 Ambient AI

- Slack/Teams/AW Chat semantic parity for core actions;

- typed action cards;

- efficient correction/dismissal/stop;

- chat-authored workflow drafts;

- no authority bypass;

- clear AI identity;

## 67.4 Low maintenance

- maintenance tier policy;

- verified auto-repair for eligible cases;

- customer/operator escalation policy;

- maintenance receipts;

- toil metrics;

- provider/connection/package/readiness/recovery integration;

## 67.5 Quality

- premium design-system convergence;

- critical legacy duplicates retired;

- WCAG 2.2 AA evidence;

- responsive/mobile critical actions;

- localization-safe components;

- performance evidence;

- usability pilots;

- support/recovery readiness;

## 67.6 Open source

- license/provenance record;

- no duplicate authority;

- exit plan;

- security review;

- net maintenance reduction demonstrated or dependency rejected;


## 67.7 Security and assurance

- Security Assurance Map covers all launch-critical V9 threats and trust boundaries;

- NIST SSDF 1.1 secure-development responsibilities are mapped to the delivery lifecycle as applicable;

- applicable OWASP ASVS 5.0.0 requirements have verification evidence or explicit scoped non-applicability;

- indirect prompt-injection, generated-UI, authorization, tenant-isolation, MCP App and agent/tool misuse negative tests pass;

- C0–C4 criticality is assigned/inherited for material actions and assurance depth matches consequence;

- no model/client/generated UI is a hard authorization boundary;

- deterministic kill/revocation paths exist for material autonomous execution.

## 67.8 Resilience, maintenance and migration

- Experience Orchestrator partial/stale/unavailable behavior is explicit and tested;

- consequential action paths fail closed on missing current authorization/version/precondition;

- Maintenance Autopilot desired-state authority, concurrency/fencing, blast-radius, loop-breaker and ambiguous-outcome behavior pass representative fault tests;

- every material migration has a Safe Change Record;

- mixed-version states, reconciliation and irreversible boundaries are tested where applicable;

- temporary migration flags/dual paths/adapters have removal owners and retirement conditions.

## 67.9 Privacy and analytics

- every material experience-analytics event family has a Data Processing Contract;

- telemetry schemas are allow-listed and raw prompts/secrets/company content are excluded by default;

- leakage, retention, deletion and cross-tenant telemetry tests pass;

- any session replay enablement has a separate approved privacy/security purpose and acceptance package.

## 67.10 Validation and release evidence

- exploratory pilots establish baseline/failure modes without being mislabeled as confirmatory proof;

- formal launch-validation rules are pre-registered before the confirmatory run;

- critical journeys have `PASS / FAIL / INCONCLUSIVE` evidence with representative roles/conditions and explicit residual uncertainty;

- `C2+` AI-mediated journeys use multi-method evals and identify re-evaluation triggers for behavior-affecting changes;

- release evidence is attributable to exact code/configuration/schema/policy/model/tool versions and released artifacts;

- unresolved material risks have an accountable owner and explicit acceptance/hold decision;

- post-deployment monitoring closes the assurance loop.



## 67.11 No-guess experience execution

- launch-critical screens/surfaces have stable Screen Contract IDs;

- canonical profile navigation is implemented;

- ONB-01–ONB-12 activation experience is implemented with exact customer-facing content/field/action/state contracts;

- Hire Agent and Custom Agent guided paths are implemented;

- agent draft/test/ready/pending-approval/active/paused/needs-attention/retired lifecycle is coherent across UI and canonical state;

- orchestration follows the §80 complexity/ownership decision contract;

- workflow lifecycle follows §81 and live revisions cannot be silently mutated;

- Company/Settings/Governance matches §82;

- content/CTA/error/recovery/loading/success receipts match §83;

- each Screen Contract maps to Storybook/component/E2E/accessibility evidence appropriate to its criticality;

- deviations from an experience contract have an explicit reviewed product/UX/architecture decision rather than an implementation convenience.

## 67.12 Customer Feedback & Product Improvement

- persistent global Feedback entrypoint exists on every authenticated surface;

- Bug / Improvement / Idea / Other feedback categories are implemented;

- urgent Support and secure security/privacy reporting are clearly separated;

- feedback context uses an allow-list and excludes raw customer content by default;

- optional diagnostics and attachments have explicit user action, preview/disclosure and security/privacy controls;

- product feedback is tenant-safe and has a canonical AW feedback domain;

- original user submission is preserved; AI/internal enrichment cannot rewrite what the customer said;

- customer receives a feedback ID/receipt and can view customer-safe status/history;

- internal triage can classify, link duplicates, request information and link to product/engineering work without leaking other customers' submissions;

- feedback volume/votes are treated as evidence, not an automatic prioritization algorithm;

- feedback events have a Data Processing Contract and configured retention/deletion behavior before GA;

- `OutputFeedbackButtons` is migrated away from Paperclip Labs sharing semantics;

- tenant-local AI-output quality/correction is separated from AW product feedback;

- feedback a11y/security/privacy/E2E tests pass;

- feedback insights are triangulated with task success, usability research, support and behavioral evidence.


# 68. Non-goals

- rewriting V4–V8 domains;

- a new workflow engine;

- a new authorization engine;

- a new Memory system;

- a generic notification/event bus;

- a new project-management backend;

- a separate mobile backend source of truth;

- a mandatory AG-UI/A2UI dependency;

- arbitrary model-generated React/HTML;

- self-hosting PostHog/GrowthBook/Chatwoot merely because they are open source;

- removing expert controls for aesthetic simplicity;

- autonomous permission expansion;

- autonomous material strategic decisions;

- making all maintenance fully autonomous;

- a fixed universal six-item navigation rule;

- a single universal UX score;

- maximizing daily active screen time;

- AI impersonation of human employees;

- feature parity by exposing every admin surface to every user;

- V9 declaring unresolved V6/V7 hosting blockers solved;

# 69. Future triggers

Only add new systems when measured evidence earns them.

| Capability | Trigger |
|---|---|

| Native mobile app | mobile usage/offline/notification needs materially exceed responsive web/channel capabilities |

| Dedicated customer-success platform | support volume/process complexity exceeds current V6 support + external tools |

| Full AG-UI internal adoption | multiple agent runtimes/frontends create measurable duplicate UI-event wiring and conformance is stable |

| A2UI production renderer | declarative dynamic UI demand is proven and stable spec/client ecosystem reduces maintenance |

| Dedicated event/notification broker | current Postgres/outbox/live-event architecture cannot meet measured latency/volume/reliability |

| Self-hosted product analytics | data-sovereignty/customer requirement outweighs added operational toil |

| Per-customer bespoke shell | only if global configuration cannot satisfy contracted requirements without product fork; default is no |

# 70. Source register — external research

| Source | URL | Use |
|---|---|---|

| ISO 9241-210:2019 | https://www.iso.org/standard/77520.html | Human-centred design lifecycle; current after 2025 review. |

| ISO 9241-11:2018 | https://committee.iso.org/standard/63500.html | Usability as effectiveness, efficiency and satisfaction in context. |

| Apple HIG — Onboarding | https://developer.apple.com/design/human-interface-guidelines/onboarding | Fast/optional onboarding, interactive learning, defaults, postpone nonessential setup. |

| AWS SaaS Lens — Tenant Onboarding | https://docs.aws.amazon.com/wellarchitected/latest/saas-lens/tenant-onboarding.html | Frictionless automated repeatable tenant onboarding. |

| AWS SaaS Lens — General principles | https://docs.aws.amazon.com/wellarchitected/latest/saas-lens/general-design-principles.html | Single SaaS experience, automated onboarding, tenant metrics, multiple experiences without one-off product forks. |

| Microsoft HAX Guidelines | https://www.microsoft.com/en-us/haxtoolkit/ai-guidelines/ | 18 validated human-AI interaction guidelines. |

| Google PAIR — Explainability + Trust | https://pair.withgoogle.com/guidebook-v2/chapter/explainability-trust/ | Calibrated trust, progressive automation, explanations/data scope. |

| Google PAIR — Feedback + Control | https://pair.withgoogle.com/guidebook-v2/chapter/feedback-controls/ | Feedback, user control, reset, balance automation/control. |

| Stanford HAI — Humans in the Loop | https://hai.stanford.edu/news/humans-loop-design-interactive-ai-systems | Human agency and granular interactive automation. |

| Stanford HAI — AI and Organizations Lab | https://hai.stanford.edu/news/stanford-hai-launches-ai-and-organizations-lab-to-study-science-of-ai-in-the-workplace | Need empirical evidence for organizational AI impacts. |

| MIT CCI/Sloan — Human+AI meta-analysis | https://mitsloan.mit.edu/press/humans-and-ai-do-they-work-better-together-or-alone | Human+AI combinations are not automatically synergistic. |

| Google SRE — Eliminating Toil | https://sre.google/sre-book/eliminating-toil/ | Automatable repetitive operational work should be engineered away. |

| W3C WCAG 2.2 | https://www.w3.org/WAI/standards-guidelines/wcag/ | Accessibility baseline. |

| EN 301 549 v4.1.1 update | https://accessible-eu-centre.ec.europa.eu/content-corner/news/european-accessibility-standard-en-301-549-has-been-updated-2026-09-07_en | 2026 standard adopts WCAG 2.2; harmonization status must be tracked. |

| EDPB Privacy by design/default | https://www.edpb.europa.eu/topics/ai-and-technology/privacy-by-design-and-by-default_en | Protective defaults and continuous privacy design. |

| EU AI Act Article 4 | https://ai-act-service-desk.ec.europa.eu/en/ai-act/article-4 | AI literacy. |

| EU AI Act Article 50 | https://ai-act-service-desk.ec.europa.eu/en/ai-act/article-50 | AI interaction transparency. |

| assistant-ui | https://github.com/assistant-ui/assistant-ui | MIT conversational UI; already installed. |

| AG-UI | https://github.com/ag-ui-protocol/ag-ui | MIT agent-user interaction protocol; optional boundary adapter. |

| A2UI | https://github.com/a2ui-project/a2ui | Apache-2.0 declarative streaming UI; v0.9.1 current production, v1.0 candidate at audit. |

| MCP Apps | https://github.com/modelcontextprotocol/ext-apps | Official stable MCP interactive UI extension, 2026-01-26. |

| Base UI | https://github.com/mui/base-ui | MIT unstyled accessible React primitives; already dependency. |

| Radix Primitives | https://github.com/radix-ui/primitives | MIT accessible low-level primitives; already dependency. |

| PostHog | https://github.com/PostHog/posthog | Open-source core/product analytics; optional managed adapter after privacy review. |

| GrowthBook | https://github.com/growthbook/growthbook | Open-core experimentation/flags; defer due domain overlap. |


| NIST SP 800-218 — SSDF 1.1 | https://csrc.nist.gov/pubs/sp/800/218/final | Current final secure-software-development baseline used by the V2 Security Assurance Overlay. |

| NIST SP 800-218 Rev.1 — SSDF 1.2 IPD | https://csrc.nist.gov/pubs/sp/800/218/r1/ipd | Draft/watch item; explicitly not treated as the final baseline. |

| OWASP Application Security Verification Standard 5.0.0 | https://owasp.org/projects/asvs | Verifiable application/web security requirements; used as the V9 technical-security verification baseline where applicable. |

| OWASP Agent Control Standard | https://genai.owasp.org/resource/agent-control-standard-acs/ | 2026 applied/emerging runtime agent-control and inspectability guidance; useful overlay, not treated as empirically complete universal law. |

| NIST AI 200-3 — ARIA Evaluation Planning Manual | https://www.nist.gov/publications/aria-evaluation-planning-manual-elements-aria-style-ai-evaluations | Holistic AI evaluation architecture combining model testing, red teaming and user testing. |

| NIST AI 800-4 — Challenges to the Monitoring of Deployed AI Systems | https://www.nist.gov/publications/challenges-monitoring-deployed-ai-systems-center-ai-standards-and-innovation | Post-deployment AI monitoring need, categories and evidence limitations. |

| MCP Apps stable specification 2026-01-26 | https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx | Normative host/sandbox/message/CSP security semantics used by §26 plus stricter AW controls. |

| PostHog Privacy documentation | https://posthog.com/docs/privacy | Optional analytics provider privacy/data-processing input only; provider claims do not replace AW's own privacy analysis. |



| Apple Feedback Assistant | https://developer.apple.com/feedback-assistant/ | Context-rich bug/enhancement feedback; diagnostics/attachments; team inbox; feedback ID/status/follow-up patterns. |

| Microsoft Feedback Hub | https://support.microsoft.com/en-us/windows/apps/send-feedback-to-microsoft-with-the-feedback-hub-app | Problem vs suggestion; support-vs-feedback distinction; optional diagnostics/screenshots; similar-feedback and tracking patterns. |

| Department for Education — Ask users for feedback | https://design.education.gov.uk/design-system/patterns/ask-users-for-feedback | Feedback after completed tasks; optional forms; anonymous/contact-optional pattern; urgent-help separation. |

| GOV.UK Publishing Design Guide — Feedback component | https://design-guide.publishing.service.gov.uk/components/feedback/ | Page-context feedback available broadly; problem-report prompts and accessible implementation precedent. |

| W3C WCAG 2.2 — Consistent Help | https://www.w3.org/WAI/WCAG22/Understanding/consistent-help | Consistent placement/order for recurring help/contact mechanisms. |

| W3C WAI-ARIA APG — Modal Dialog Pattern | https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/ | Dialog focus containment, Escape, initial focus and focus return semantics. |

| W3C WCAG 2.2 — Target Size (Enhanced) | https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced | Selected AAA internal 44×44 CSS px target for frequent/critical/custom controls where applicable. |

| Anthropic — Building Effective Agents | https://www.anthropic.com/engineering/building-effective-agents | Workflow vs agent distinction; least-complex adequate solution; orchestrator-worker pattern and bounded complexity. |

| OpenAI Agents SDK — Agent orchestration | https://openai.github.io/openai-agents-python/multi_agent/ | Code vs model orchestration; manager/agents-as-tools vs handoff customer-conversation ownership patterns. |

| Microsoft Copilot Studio — Create a new agent | https://learn.microsoft.com/en-us/microsoft-copilot-studio/agents-experience/build-new-agent | Current agent authoring benchmark: identity/instructions/knowledge/tools/skills/connected agents/model/memory/test/evaluate/publish/monitor. |

| Microsoft Copilot Studio — Publish an agent | https://learn.microsoft.com/en-us/microsoft-copilot-studio/agents-experience/publication-publish-agent | Draft/test/readiness/publish/channel-policy and republish-on-change benchmark. |

| Microsoft Copilot Studio — Agent flows | https://learn.microsoft.com/en-us/microsoft-copilot-studio/flows-overview | Deterministic trigger/action flow benchmark for repeatable work. |

| NIST AI 200-3 — ARIA Evaluation Planning Manual | https://www.nist.gov/publications/aria-evaluation-planning-manual-elements-aria-style-ai-evaluations | Current holistic AI evaluation approach: model testing + red teaming + user testing. |

| Canny — Board settings / embedded feedback | https://help.canny.io/en/articles/4968514-board-settings | Applied product-feedback pattern reference for categories/privacy/embedded collection only; not an AW source-of-truth mandate. |


# 71. Appendix A — supplied playbook inventory

The following 35 source files were materialized and re-read for the V9 audit. **No standalone `06 — Security Engineering` file was included in the supplied corpus.** V2 closes that documented source gap through §5.8's primary-source Security Assurance Overlay rather than inventing or attributing a missing playbook:

- `01_requirements_specification_domain_engineering_master_playbook_v2.2.md`

- `02_software_architecture_system_design_v2.1_research_audited_golden_master.md`

- `03_engineering_workflow_sdlc_configuration_management_v2.md`

- `04_software_construction_code_quality_v2.md`

- `05_verification_validation_testing_quality_engineering_v2.md`

- `07_privacy_data_protection_engineering_v2.md`

- `08_reliability_resilience_observability_sre_v2_golden_master.md`

- `09_performance_scalability_resource_cost_engineering_v2.md`

- `10_devops_cicd_release_platform_supply_chain_v2.md`

- `11_maintenance_evolution_migration_technical_debt_v2.md`

- `12_data_database_storage_engineering_v2_golden_master.md`

- `13_api_integration_distributed_systems_engineering_v2_golden_master.md`

- `15_backend_services_engine_engineering_v2.md`

- `16_mobile_desktop_application_engineering_v2.md`

- `17_cloud_infrastructure_networking_iac_v2.md`

- `18_ai_ml_llm_systems_engineering_master_playbook_v2.md`

- `19_agentic_ai_engineering_v2_golden_master.md`

- `20_blockchain_smart_contract_engineering_v2.md`

- `21_systems_embedded_real_time_engineering_v2.md`

- `22_language_runtime_engineering_standards_v2.md`

- `brand_strategy_positioning_master_playbook_v2.md`

- `concept_business_design_master_playbook_v2.md`

- `digital_graphics_illustration_generative_visual_production_master_playbook_v2.1_golden_master.md`

- `digital_visual_design_art_direction_master_playbook_v2.1_golden_master.md`

- `google_ads_master_playbook_v2.md`

- `market_validation_pretotyping_master_playbook_v2.md`

- `marketing_measurement_attribution_master_playbook_v2.md`

- `master_playbook_standard_v2.0.md`

- `meta_ads_master_playbook_v2.md`

- `organic_discoverability_master_playbook_v2.md`

- `ui_master_playbook_v2.md`

- `universal_design_principles_master_playbook_v2.md`

- `universal_software_ai_engineering_master_playbook_v2.md`

- `ux_master_playbook_v2_double_validated_2026-09-21.md`

- `web_frontend_engineering_master_playbook_v2.md`

# 72. Appendix B — V9 customer-facing capability map

This map prevents backend-domain leakage into default navigation.

| Customer job | Primary surface | Underlying domains |
|---|---|---|

| What needs my attention? | Needs You / channel | Attention, Decisions, Approvals, Readiness, Governance, Supervision |

| What is happening? | Home / status card / chat | Tasks, runs, Workflows, activity, V8 insights |

| Get this done | Chat / Work | Tasks, Agents, Runtime Fabric, Workflows |

| Hire AI help | Agents | Agent Packages, Role Packs, Skills, use-case governance |

| Connect a system | Apps / contextual connection request | Connections, grants, secrets, Tool Gateway |

| Automate a process | Chat / Workflows | V4 Workflow authoring, optimizer, approvals |

| Teach/correct AI | Output correction / feedback | Memory, Learning, package/skill proposals |

| Understand why | card drill-down | Context Manifest, evidence, audit, V8 lineage |

| Manage the company AI setup | Company/Advanced | Foundation, governance, identity, runtime, security |

# 73. Appendix C — V9 experience quality scorecard

Do not average catastrophic failures away. Score with evidence for each critical journey.

- **Outcome/task success:** evidence + observed defects + owner + next validation.

- **Findability:** evidence + observed defects + owner + next validation.

- **Comprehension:** evidence + observed defects + owner + next validation.

- **Effort:** evidence + observed defects + owner + next validation.

- **Predictability:** evidence + observed defects + owner + next validation.

- **Feedback:** evidence + observed defects + owner + next validation.

- **Recovery:** evidence + observed defects + owner + next validation.

- **Speed:** evidence + observed defects + owner + next validation.

- **Accessibility:** evidence + observed defects + owner + next validation.

- **Trust:** evidence + observed defects + owner + next validation.

- **Control/reversibility:** evidence + observed defects + owner + next validation.

- **End-to-end/channel continuity:** evidence + observed defects + owner + next validation.

- **AI reliance calibration:** evidence + observed defects + owner + next validation.

- **Interruption burden:** evidence + observed defects + owner + next validation.

- **Critical attention recall / missed-action risk:** evidence + observed defects + owner + next validation.

- **Projection truthfulness / freshness:** evidence + observed defects + owner + next validation.

- **Security control effectiveness:** evidence + observed defects + owner + next validation.

- **Maintenance burden:** evidence + observed defects + owner + next validation.

- **Evidence quality:** evidence + observed defects + owner + next validation.

# 74. Final implementation directive

A coding agent implementing V9 should not need to invent the core product doctrine.

```text
DO NOT build another platform on top of August Works.

BUILD an experience layer that:
- gets customers to verified value quickly,
- hides implementation complexity until it matters,
- lets ordinary users work through familiar channels,
- makes chat a governed authoring/control surface,
- turns agent output into typed actionable UI,
- consolidates human attention,
- automates safe maintenance and recovery,
- preserves full expert/admin depth,
- improves accessibility/performance/recovery,
- converges duplicate UI code,
- measures customer effort, critical-attention recall and maintenance burden,
- makes security/privacy/AI/UX claims traceable to release evidence,
- migrates through valid intermediate states with reconciliation and cleanup,
- and never weakens V4–V8 authority, compliance or safety.
```

> **V9 is successful when August Works feels substantially simpler while doing substantially more — because the complexity has been absorbed by governed software, not merely hidden from the customer.**

---


# 75. V9 assurance lifecycle and release status

V9 uses explicit status gates so design/research quality cannot silently become a production claim.

## 75.1 A — Research-Audited

**V2 status: EARNED**

Requires:

- current-enough authoritative sources for material fast-moving claims;
- relevant supplied playbook cross-check;
- repo-fit review;
- explicit contradictions/uncertainty;
- adversarial/falsification pass;
- architecture/non-goal clarity.

## 75.2 B — Security-Overlaid & Assurance-Hardened / Implementation-Ready

**V2 status: EARNED as a build brief**

Requires the architecture in this document to include:

- explicit security assurance chain;
- consequence/assurance model;
- untrusted-content boundaries;
- resilient projection semantics;
- maintenance authority/concurrency controls;
- privacy-bound telemetry contracts;
- Safe Change/migration controls;
- pre-registered validation architecture.

This status means a competent implementation team/coding agent should not need to invent the core safety/assurance doctrine.

## 75.3 C — System-Tested

**Status: NOT YET EARNED**

Requires implementation evidence from the applicable Waves/PRs:

- deterministic/unit/domain verification;
- integration/contract tests;
- real-browser/channel E2E;
- security/adversarial tests;
- accessibility manual + automated evidence;
- AI eval portfolio;
- migration/reconciliation rehearsal;
- overload/failure/recovery testing;
- exact-artifact attribution.

A green CI pipeline alone is insufficient.

## 75.4 D — Production-Validated

**Status: NOT YET EARNED**

Requires:

- representative real/customer/operator use;
- formal pre-registered critical-journey validation;
- live managed runtime/provider/channel evidence where claimed;
- production monitoring and support/recovery readiness;
- closure/acceptance of material defects and risks;
- applicable V6/V7 hosting/runtime qualification gates;
- evidence that customer/operator toil and interruption outcomes are acceptable in real operation.

Production validation is continuously re-opened by material behavior-affecting changes, incidents, source/provider changes, new threat evidence or material context drift.

## 75.5 Current final verdict

```text
V9 PRODUCT / EXPERIENCE DIRECTION                    STRONG PASS
V9 EXPERIENCE ARCHITECTURE                           STRONG PASS
V9 SECURITY / ASSURANCE ARCHITECTURE                 STRONG PASS AFTER V2 HARDENING
V9 IMPLEMENTATION-READY BUILD BRIEF                  PASS
V9 SYSTEM-TESTED                                     PENDING IMPLEMENTATION EVIDENCE
V9 PRODUCTION-VALIDATED                              PENDING FIELD + V6/V7 EVIDENCE
NEW V9 ARCHITECTURE-BREAKING BLOCKERS                NONE IDENTIFIED
INHERITED V6/V7 PHYSICAL/RUNTIME BLOCKERS            REMAIN OPEN UNTIL THEIR GATES PASS
```

The highest defensible standard before implementation is therefore **research-audited, security-overlaid, assurance-hardened and implementation-ready with explicit evidence debt**—not a claim that unbuilt or unfield-tested behavior has already been validated.


---


# 76. V3 Experience Execution Golden Master — no-guess build contract

V3 specializes the architecture above into implementable customer experience contracts.

## 76.1 Governing implementation rule

> **A coding agent implements product/UX policy; it does not invent it.**

For every launch-critical customer-facing route, dialog, action card or cross-channel interaction, one of the following must be true:

1. this brief defines the exact default;
2. an inherited canonical domain contract defines the behavior;
3. a reviewed V9/V3 experience decision/ADR explicitly defines a contextual exception.

Implementation convenience is not a fourth source of truth.

If a local implementation reveals a genuine contradiction or missing material decision, treat that as a **specification defect**. Do not silently add:

- a required field;
- an onboarding step;
- a permission request;
- a confirmation dialog;
- a navigation item;
- an agent autonomy grant;
- a model/provider choice;
- a new feedback destination;
- a new customer-visible backend term.

## 76.2 Mandatory Screen Contract

Every covered screen/surface has a stable contract:

```yaml
screen_id:
journey_id:
route_or_surface:
target_experience_profiles: []
customer_outcome:
entry_conditions: []
exit_conditions: []

content:
  h1:
  supporting_copy:
  customer_terms: []
  displayed_state: []

inputs:
  - id:
    label:
    data_type:
    required:
    default:
    help:
    validation:
    autofill_or_prefill:

actions:
  primary:
    label:
    operation:
  secondary: []
  destructive_or_irreversible: []

system_work:
  canonical_read_domains: []
  canonical_write_operation:
  authority_effect:
  async_work:
  receipt:

states:
  loading:
  empty:
  partial:
  stale:
  validation_error:
  system_error:
  permission_denied:
  recovering:
  success:

navigation:
  back:
  cancel_or_save_exit:
  deep_link:
  resume:

accessibility:
  initial_focus:
  focus_after_error:
  focus_after_success:
  keyboard_model:
  status_announcement:
  target_size:
  zoom_reflow:
  reduced_motion:
  screen_reader_notes:

responsive:
  wide:
  narrow:
  mobile:

privacy_security:
  data_shown:
  data_collected:
  sensitive_fields:
  logging_constraints:

analytics:
  allowed_events: []
  prohibited_payloads: []

acceptance:
  functional: []
  accessibility: []
  security_privacy: []
  usability: []
```

A field may be intentionally `N/A`, but launch-critical contracts cannot leave material behavior undefined.

## 76.3 Screen-contract storage and coverage

Create an implementation-readable V9 experience contract manifest under the repository documentation/experience area and map each contract to:

- route/component;
- Storybook state coverage where relevant;
- E2E journey;
- accessibility evidence;
- canonical API/domain operation;
- criticality;
- owner.

CI SHOULD fail a V3 coverage check when a launch-critical surface named in the manifest is missing its required contract/test mapping.

## 76.4 Customer-effort doctrine

Do not optimize screen count or click count in isolation.

Minimize:

```text
unnecessary decision effort
+ repeated data entry
+ context switching
+ hidden-state reconstruction
+ permission/setup tax
+ recovery effort
+ waiting uncertainty
```

while preserving:

```text
comprehension
+ appropriate control
+ safety
+ privacy
+ accessibility
+ confidence
+ successful completion
```

Protective friction is deliberate only when removing it creates material error, authority, privacy, security or irreversibility risk.

---

# 77. Canonical navigation and daily-experience execution specification

## 77.1 Launch navigation by experience profile

The launch default is:

| Profile | Default primary navigation |
|---|---|
| Member | `Home` · `Needs You` · `Work` · `Agents` · `Apps` |
| Manager / Owner | Member set + `Insights` |
| AI Lead / Admin | Manager set + `Company` |
| Security / Compliance Admin | Admin set; `Company` opens full Trust/Governance depth |
| Platform Operator | separate operator-only tooling; not customer navigation |

`Ask August` is a persistent global entrypoint rather than another backend-domain page.

Personal/account preferences live in the account/profile utility area, not as another primary customer-domain item.

## 77.2 Global shell utility area

On every authenticated normal product surface provide, in a consistent utility area:

```text
Ask / Command
Feedback
Help / Support entry
User / Account
```

`Feedback` is governed by §85.

### Wide layout

Use a text-labelled `Feedback` action in the persistent shell utility/footer area. Do not hide it inside Company settings.

### Collapsed/narrow layout

Use the same semantic action in the persistent header/utility cluster or first-level shell menu. It must remain reachable without navigating to a settings page.

Do not place a floating feedback button over product content as the default; persistent shell placement avoids obscuring focus, tables, action cards and narrow-screen controls.

## 77.3 Home

The canonical Home hierarchy is:

1. **Ask August** — direct outcome entry.
2. **Needs You** — only when there are actionable items.
3. **In Progress** — customer-relevant active work.
4. **Done** — meaningful outcomes, not raw agent/run event noise.
5. **Watch** — material non-action-required risk/change.

Rules:

- omit sections with no meaningful content rather than rendering empty dashboard furniture;
- `Needs You` outranks passive status;
- `Watch` does not become a duplicate alert inbox;
- every item links to or operates on a canonical object;
- partial/stale/unavailable state follows §9.2.

## 77.4 Needs You card contract

Every card renders in this order:

```text
TITLE             what happened
WHY YOU           why this person must act
CONSEQUENCE       what happens if no action is taken
EVIDENCE          compact source/state when decision-relevant
PRIMARY ACTION    most likely correct next action
SECONDARY         reject/change/reconnect/snooze/stop/etc.
MORE DETAIL       only if the decision genuinely needs it
FRESHNESS         when a stale action would be harmful
```

Never use generic customer copy such as `Agent requires attention` when a specific consequence can be stated.

Example:

```text
Google Ads needs to be reconnected

Growth Specialist can still analyse existing results,
but cannot refresh campaign performance.

[Reconnect]  [Remind me tomorrow]
```

## 77.5 Work

`Work` groups user-recognizable work objects/outcomes. It must not require ordinary members to distinguish internal runtime/run/workflow-engine concepts.

Primary representations:

- Projects/outcomes where durable;
- Tasks/assignments;
- Routines/automations;
- active/recent work.

Expert run/debug views remain available by drill-down/Advanced when authorized.

## 77.6 Customer terminology boundary

Default member/manager UI SHOULD prefer:

| Internal implementation term | Customer-facing concept |
|---|---|
| Foundation | Company knowledge / company context |
| Role Pack | Agent role/capability |
| Runtime Fabric | Advanced runtime |
| Readiness | Setup/availability check or specific blocker |
| Orchestration | Collaboration/delegation when it matters |
| Cognitive/Derived Providers | hidden implementation detail |
| Work Signals | concrete insight/signal |
| Security Export | Audit & Evidence / security export |
| package version internals | agent update/version where material |

The internal canonical name remains available in technical evidence/admin views when useful.

---

# 78. Canonical onboarding / activation execution specification

## 78.1 Activation shell

After authentication, activation uses a **route-based full-page onboarding shell**, not a modal stacked over a second interactive page.

Header:

```text
August Works
Getting started: Company → First task → Access → Result
Feedback
```

Once the organization exists, include `Save & exit`.

Rules:

- browser Back and product Back preserve entered state;
- progress shows meaningful stages, not fake percent-complete;
- no feature tour;
- no pricing comparison before Free Core first value;
- no model/provider/runtime/Role Pack/Skill terminology in the ordinary path;
- every committed step persists to the durable onboarding run;
- any nonterminal state is resumable.

The 12-screen sequence below is the launch HOUSE default.

## 78.2 ONB-01 — Create your account

**Outcome:** establish identity with the least available friction.

**H1:** `Create your account`

Render only the authentication methods actually supported/configured by the canonical auth domain. Prefer configured organizational/SSO methods where relevant; provide supported email fallback.

Rules:

- password managers/paste are allowed;
- no unrelated profile questionnaire;
- authentication failure preserves entered non-secret data where appropriate;
- after success, continue directly to ONB-02.

Primary action label reflects the selected method (`Continue with Microsoft`, `Continue with Google`, `Continue`, etc.), never generic `Submit`.

## 78.3 ONB-02 — Company

**H1:** `Tell us about your company`

Fields:

| Field | Requirement |
|---|---|
| Company name | required |
| Website/domain | optional |

Do not ask industry/headcount/department/address merely because those fields may exist elsewhere.

Primary: `Continue`

Secondary: `Save & exit` after a durable organization exists.

System: create/update the canonical organization through the existing company/onboarding authority.

## 78.4 ONB-03 — First outcome intent

**H1:** `What would you like August Works to help with first?`

Required: one free-text outcome/goal.

Optional example chips may insert editable examples such as:

- `Research and prepare sales opportunities`
- `Keep projects moving`
- `Review marketing performance`
- `Turn meetings into follow-up work`

Examples are discovery aids, not a forced taxonomy.

Primary: `Continue`

The raw intent is canonical onboarding/customer data and is **not** sent as generic product analytics content.

## 78.5 ONB-04 — Discovery permission/context

**H1:** `Let us understand your company`

Explain:

- which customer-provided/public/connected sources are available for this discovery pass;
- that AW creates a **draft** understanding;
- that the user confirms material facts;
- that source content cannot expand permissions/authority.

Primary: `Build company draft`

Secondary: `I'll tell you instead`

No source that requires a new permission is silently included.

## 78.6 ONB-05 — Discovery progress

**H1:** `Understanding [Company]`

Show truthful source/milestone status, for example:

```text
Website                 Done
Company information     Done
Connected CRM           Not connected
Drafting key facts      Working
```

Do not show invented percentage progress.

User may leave/close; work continues if safely supported and resume returns to current state.

Per-source failure:

- explain which source failed;
- preserve successful evidence;
- offer `Try again` where safe;
- offer `Continue without this source` when that still permits a trustworthy first outcome.

## 78.7 ONB-06 — Confirm material facts

**H1:** `Does this look right?`

Show only facts that materially change the recommended first capability, context, authority or expected output.

Each fact:

```text
FACT
Source
[Change]
```

Primary: `Looks right`

If a critical fact is unknown, ask a direct contextual question rather than opening the full Foundation taxonomy.

User edits create typed Foundation proposals/confirmed values under existing governance.

## 78.8 ONB-07 — Recommended first capability

**H1:** `A good first step`

Show one recommended capability/Agent Package card with:

```text
WHAT IT HELPS WITH
WHAT IT NEEDS
WHAT IT CAN DO AUTOMATICALLY
WHAT IT ASKS BEFORE
IMPORTANT LIMITATIONS
```

Primary: `Use this agent`

Secondary: `Choose another`

Do not expose model/runtime/config bundle selection.

## 78.9 ONB-08 — Required access

Repeat this screen for each **materially separate** required connection/permission decision.

**H1:** `Connect [System]`

Permission preview MUST show:

| Label | Meaning |
|---|---|
| Needed now | exact scope/resource |
| Why | first-outcome purpose |
| Used by | agent/capability |
| Can read | exact meaningful data scope |
| Can change | write scope, or `Nothing` |
| Not requested | relevant broader scopes explicitly excluded |
| Automatic | allowed automatic use |
| Asks first | consequential operations |

Primary: `Connect [System]`

Secondary: `Not now`

If `Not now` is chosen, explain the concrete degraded outcome and allow a safe alternative where possible.

OAuth/provider consent is not itself AW authorization.

## 78.10 ONB-09 — Check first run

**H1:** `Ready for your first run`

Render a check-your-answers summary:

- goal;
- selected agent;
- input/context sources;
- permissions;
- actions that may occur;
- actions that cannot occur without approval;
- expected output.

Launch default first run MUST NOT send externally, spend money, delete data, broaden permissions or make another hard-to-reverse effect.

Primary: `Run first task`

Secondary: `Change setup`

## 78.11 ONB-10 — First run in progress

**H1:** `Working on it`

Show customer-meaningful milestones, not hidden reasoning/chain-of-thought.

Actions:

- `Stop` if stoppable;
- `Leave and come back` / ordinary navigation where safe.

If blocked, route the exact blocker into this surface/Needs You; do not make the user inspect a runtime console.

## 78.12 ONB-11 — First result

**H1:** `Your first result is ready`

Show:

- result/artifact;
- concise source/evidence/verification summary;
- material limitation/uncertainty where needed.

Primary: `Use result`

Secondary actions as applicable:

- `Edit`
- `Correct`
- `Try again`
- `Why?`

Correction follows Memory/Learning governance; it does not silently rewrite production policy.

## 78.13 ONB-12 — Activated

**H1:** `You're ready`

Show:

- first active agent/capability;
- what it will now handle;
- where future action requests appear (`Needs You`);
- how to stop/change it.

Primary: `Go to Home`

Optional next steps, visually secondary:

- `Add Slack/Teams`
- `Invite teammates`
- `Hire another agent`
- `Connect another app`

Never make expansion required to complete activation.

## 78.14 Onboarding error/resume rules

For every screen:

- preserve valid entered state;
- distinguish validation from system/provider failure;
- state whether already-created company/data/work is safe;
- retry only safe operations;
- resume at the first incomplete material state, not necessarily the previously visible screen;
- stale browser steps re-resolve against canonical onboarding state;
- Back never creates duplicate organization/agent/run effects.

## 78.15 Onboarding analytics

Allowed event examples:

```text
activation_started
activation_screen_completed(screen_id)
activation_saved_exited(screen_id)
activation_resumed(screen_id)
connection_requested(connection_type)
first_outcome_started
first_outcome_verified
activation_completed
```

Do not include raw intent, company facts, prompts, documents or result content in generic experience analytics.

---

# 79. Agent provisioning, Custom Agent and agent-lifecycle execution specification

## 79.1 Two customer products, one canonical agent model

August Works exposes:

1. **Hire Agent** — ordinary customer path; choose a capability/outcome.
2. **Create Custom Agent** — authorized Advanced path; explicitly configure behavior/authority.

Both commit to the same canonical V5/V7 agent/package/runtime/governance domains.

## 79.2 Hire Agent flow

### HIRE-01 — Agent catalog

Primary: `Hire agent`

Browse/search by business outcome/capability, not implementation bundle.

Each result shows:

- role/capability name;
- one-line customer outcome;
- connected-app prerequisites if material;
- high-level automatic/approval behavior.

### HIRE-02 — Capability detail

Show:

```text
Does
Needs
Can do automatically
Asks before
Important limits
Owner / accountable role where configured
```

Primary: `Use this agent`

Secondary: `Back to agents`

### HIRE-03 — Missing access

Only show missing access actually required for selected initial capability.

Reuse §78.9 permission contract.

### HIRE-04 — Authority preview

Plain-language table of capability-specific autonomy:

```text
Read / analyse                 Automatic
Create internal drafts/tasks  Automatic
External send                 Ask first
Spend / financial action      Ask first / unavailable
Permission changes            Never self-granted
```

Primary: `Continue`

### HIRE-05 — Safe representative test

Run a non-destructive representative test using available/synthetic/customer-approved data.

Show expected versus actual outcome and any blocker.

Primary on pass: `Continue`

On failure: `Fix setup` / relevant recovery.

### HIRE-06 — Review

Check:

- role/outcome;
- knowledge scope;
- app/data scope;
- automatic actions;
- approvals;
- channel/audience;
- owner.

Primary: `Hire agent`

This is the activation/publish action.

### HIRE-07 — Receipt

Show:

- agent active;
- exact version/package;
- where it works;
- what it may do;
- where it will ask for human action;
- `Open agent`;
- `Pause agent`.

## 79.3 Custom Agent builder frame

Route under Advanced (`Agents → Create custom agent`).

Use a durable draft with `Save & exit`.

First-time authoring guides the user sequentially. Completed sections remain directly addressable for authorized experts.

### CUSTOM-01 — Outcome & owner

Question: `What should this agent be responsible for?`

Fields:

- responsibility/outcome — required;
- accountable owner — required for production-bound agent.

AW may suggest a bounded scope, but the user confirms it.

### CUSTOM-02 — Identity

Fields:

- agent name — required;
- short customer-facing description — required;
- optional internal description.

AW may draft values; user can edit.

### CUSTOM-03 — Instructions

Default structured editor:

- purpose;
- responsibilities;
- what it should not do;
- what to do when information is missing/ambiguous;
- escalation/handoff behavior;
- communication style only when material.

An Advanced raw/effective-instructions inspector MAY exist, but ordinary authoring uses structured concepts.

Instructions cannot grant capabilities that are not present in canonical tools/knowledge/policy.

### CUSTOM-04 — Knowledge

Show available company knowledge/sources by recognizable source.

Default: only knowledge required by declared responsibility.

For each source show:

- read scope;
- freshness/lifecycle where material;
- sensitivity classification where material.

### CUSTOM-05 — Tools & apps

Separate read from write.

For each selected capability:

- operation;
- resource scope;
- side-effect class;
- data sensitivity;
- missing connection/grant;
- recovery semantics where consequential.

Never offer a broad token/whole-account grant merely because a narrow tool is harder to configure.

### CUSTOM-06 — Authority

Configure autonomy **per capability**, not as one global `autonomous on/off`.

Customer labels:

```text
Can do automatically
Asks before
Not allowed
```

High-consequence domain policy may make a choice unavailable.

### CUSTOM-07 — Memory

Customer-facing choices describe outcome, not backend taxonomy:

- no persistent personalization;
- remember approved work preferences/context;
- use approved company/shared knowledge.

Show correction/reset/delete scope.

Advanced detail exposes memory class, provenance, subject/tenant, sensitivity, retention/revalidation policy and write authority.

### CUSTOM-08 — Collaboration

Default: no agent-to-agent delegation unless the responsibility earns it.

If enabled:

- selectable agent(s);
- exact delegation purpose/capabilities;
- redelegation allowed/forbidden;
- aggregate step/time/cost limits;
- cancellation/kill propagation.

Peer-agent output is treated as a claim until the consuming boundary's required verification occurs.

### CUSTOM-09 — Runtime

Ordinary default: `Recommended managed runtime` when qualified.

Only authorized Advanced users see alternatives such as provider/runtime/sandbox configuration.

Changing runtime may invalidate evaluation/qualification evidence and must show that consequence.

### CUSTOM-10 — Test

Run representative scenarios before publish.

Test view shows:

- user/input scenario;
- selected tools/agents;
- customer-safe action trace;
- approvals requested;
- side effects (sandboxed/simulated as appropriate);
- result;
- verification/failure;
- latency/cost where decision-relevant.

No private chain-of-thought.

### CUSTOM-11 — Review changes

Check-your-agent / diff:

- identity/outcome;
- instruction changes;
- knowledge;
- tools;
- authority;
- memory;
- delegation;
- runtime;
- evaluation result;
- channels/audience.

Material live-agent changes invalidate previous approval where their policy/action hash requires it.

### CUSTOM-12 — Publish

Primary: `Publish agent`

Show blockers/readiness before enabling action.

Configure only relevant audience/channel/trigger.

Publishing creates/activates an identified version; it does not mutate a live version in place invisibly.

### CUSTOM-13 — Monitor & improve

Post-publish overview:

- Active version;
- status;
- recent outcomes/runs;
- Needs You/open issues;
- eval/quality signals;
- connections/readiness;
- `Edit draft`;
- `Pause`;
- `Retire`.

## 79.4 Canonical customer-visible lifecycle

```text
DRAFT
→ TESTING
→ READY
→ PENDING_APPROVAL   (when required)
→ ACTIVE
→ PAUSED
→ NEEDS_ATTENTION
→ RETIRED
```

`NEEDS_ATTENTION` is an operational condition that can coexist with a specific underlying version; customer UI explains the blocker.

## 79.5 Live revision rule

Editing an `ACTIVE` agent creates/updates a **draft revision**.

```text
ACTIVE v3        remains in production
DRAFT v4         edited/tested/reviewed
Publish v4
→ v4 ACTIVE
→ v3 historical
```

No text-field blur, autosave or AI suggestion may silently alter the active production behavior.

## 79.6 Pause versus retire

`Pause`:
- stop new autonomous work/triggers;
- preserve configuration/history;
- pending running work follows explicit drain/cancel policy.

`Retire`:
- stop future use;
- close/reassign pending work;
- revoke/cleanup grants/credentials no longer needed;
- preserve required audit/evidence;
- apply data/memory retention/deletion policy.

---

# 80. Orchestration and multi-agent customer-experience contract

## 80.1 Product rule

> **The customer describes the outcome and constraints. August Works selects the least complex adequate execution model.**

Ordinary members are not required to design agent topology.

## 80.2 Canonical selection logic

| Situation | Default execution model |
|---|---|
| deterministic software can satisfy the outcome adequately | deterministic software |
| known stable repeatable sequence | governed workflow |
| open-ended task within one specialist scope | single agent |
| multiple specialists contribute but one should own final customer result/conversation | manager agent with specialists as tools |
| a specialist should become the active customer-facing expert | handoff |
| task cannot know subtasks in advance and dynamic decomposition is justified | orchestrator-workers |
| independent subtasks can execute concurrently | bounded parallel workers |
| multiple agents add no material specialization/isolation/interoperability value | do **not** use multi-agent |

Latency, cost and coordination failure count against unnecessary agent complexity.

## 80.3 Customer-facing projection

Member/manager UI shows:

```text
Owned by: Growth Specialist
Helped by: Finance Specialist
Status: Analysing pipeline
```

It does not expose an orchestration DAG unless the user enters authorized Advanced/inspection depth.

## 80.4 Advanced orchestration view

When multiple agents are justified, authorized admins can inspect:

- responsible/manager agent;
- worker/specialist identities;
- allowed delegation edges;
- action/tool scope by agent;
- redelegation policy;
- shared/private memory scope;
- max depth/fan-out/steps/time/cost;
- kill/cancellation propagation;
- current/historical task tree;
- provenance of peer results.

## 80.5 Multi-agent invariants

- each agent has independent identity;
- trust is non-transitive;
- authority attenuates on delegation unless explicit policy grants otherwise;
- peer messages/results are untrusted claims at the receiving boundary;
- global task-tree budgets exist;
- shared memory has explicit write/read policy;
- compromised/failed peer can be revoked without redesigning the whole system;
- kill/cancel propagates deterministically;
- the manager/supervisor model is not itself the security boundary.

## 80.6 Customer takeover

For user-visible long-running work, provide proportional:

- `Stop`;
- `Pause` when semantics support it;
- `Take over` / manual continuation where a human can safely continue;
- escalation to responsible owner.

Do not implement a "kill-switch prompt" as the stop mechanism.

---

# 81. Workflow authoring, publishing, operation and recovery execution specification

## 81.1 Default creation entry

Customer may begin from chat/Ask August:

`Every Monday, review HubSpot deals over 50k and ask me before outreach.`

The system creates a **draft**, never a live workflow.

## 81.2 Lifecycle

```text
DESCRIBE
→ DRAFT
→ REVIEW FLOW
→ ACCESS
→ APPROVAL POLICY
→ TEST
→ INSPECT
→ FIX
→ CHECK
→ PUBLISH
→ OPERATE
→ CHANGE
→ RECOVER
→ RETIRE
```

## 81.3 Describe

Capture:

- desired outcome;
- trigger/cadence;
- source objects;
- key conditions;
- intended final effect;
- where human judgment is required.

Do not require the user to translate intent into node types.

## 81.4 Draft

AW proposes:

- trigger;
- ordered/conditional steps;
- agent/tool selection;
- required data;
- writes/side effects;
- approval checkpoints;
- time/cost estimate where meaningful.

## 81.5 Review flow

Default representation: plain-language ordered flow.

Graph view is secondary/Advanced when topology materially improves understanding.

Every step exposes:

- actor/tool;
- input;
- effect;
- retry/idempotency implications if material;
- approval state.

## 81.6 Access

Show missing connection/permission at the step that needs it.

Use §29 / §78.9 permission-preview contract.

## 81.7 Approval policy

Explicitly show:

```text
automatic steps
human-approval steps
forbidden/unavailable steps
```

Approval is bound to the canonical action/resource/material arguments according to inherited governance.

## 81.8 Test

Test before Publish.

Test mode defines:

- representative/synthetic/customer-approved input;
- whether writes are simulated, sandboxed or directed to test targets;
- expected outcomes;
- stop criteria.

A test that can create real side effects must disclose that before execution.

## 81.9 Inspect

Show customer-safe execution trace:

- which branch ran;
- which tool/agent was selected;
- result/status;
- error/verification;
- approval checkpoints.

No hidden chain-of-thought.

## 81.10 Fix

Allow editing the specific trigger/step/condition/access/approval that failed rather than forcing full recreation.

## 81.11 Check before publish

Review:

- trigger;
- flow;
- connected data;
- automatic writes;
- approvals;
- external recipients/effects;
- agent/tool versions where material;
- expected cost/capacity;
- test result.

Primary: `Publish workflow`

## 81.12 Publish

Publishing creates an identified immutable/reconstructable active workflow revision.

Live revision changes use:

```text
ACTIVE vN
+ DRAFT vN+1
→ test
→ review
→ publish
```

Do not silently modify `ACTIVE vN`.

## 81.13 Operate

Workflow overview shows:

- Active / Paused / Needs attention;
- next trigger;
- recent outcomes;
- open blocker;
- current version;
- run history;
- `Run now` if safe/authorized;
- `Pause`;
- `Edit draft`.

## 81.14 Recovery

Retry only when the failed operation/effect is safe to repeat.

Otherwise use reconciliation / compensation / operator/user action according to canonical domain semantics.

Unknown external outcomes are reconciled before retry.

## 81.15 Retire

Retirement:

- stops new triggers;
- handles active/pending work according to explicit drain/cancel policy;
- removes temporary schedules/subscriptions/grants no longer required;
- preserves required history/evidence;
- retires drafts/old paths deliberately.

---

# 82. Company, Governance, Compliance and Settings execution specification

## 82.1 Canonical Company/Admin information architecture

Authorized admins see:

| Area | Customer job |
|---|---|
| **General** | company identity, locale/timezone, general defaults |
| **People & Access** | members, roles, groups, invitations, SSO, SCIM |
| **Agents & AI** | agents, owners, customer-facing AI defaults/policies |
| **Apps & Data** | connections, granted scopes, approved data sources, data-location context |
| **Governance & Compliance** | governed use cases, policies, approval/readiness rules, AI literacy evidence, compliance configuration |
| **Security** | authentication/security posture, service identities, support access, incident/isolation controls |
| **Data & Privacy** | retention, deletion, exports, processors/subprocessors, residency/transfer settings |
| **Audit & Evidence** | activity/audit, security export, eval/release/governance evidence |
| **Billing & Capacity** | plan, managed compute/storage/capacity and usage boundaries |
| **Advanced / Developer** | runtime/providers, API/webhooks/protocol integrations, low-level technical settings |

Exact entries are permission filtered; the categories remain stable enough to build a predictable mental model.

## 82.2 Settings are not a dumping ground

A setting belongs in Company/Account only when it is:

- cross-task/global;
- persistent preference/policy;
- administrative configuration;
- not better understood at the moment of use.

Task/object-specific configuration remains on the relevant Agent, App, Workflow, Project or permission flow.

## 82.3 Contextual governance rule

Governance appears when consequence earns it.

```text
LOW-CONSEQUENCE, ALREADY-AUTHORIZED WORK
→ safe defaults; no governance ceremony

NEW DATA SOURCE / PERMISSION
→ scope/purpose explanation at connection point

EXTERNAL COMMUNICATION / MATERIAL WRITE
→ approval/authority policy at relevant action

SPEND / DESTRUCTIVE / HIGH-RISK CHANGE
→ stronger confirmation/approval/owner/evidence

ENTERPRISE / REGULATED USE CASE
→ required readiness/governance evidence before production exposure
```

Do not make ordinary first-value onboarding ask users to choose risk class, retention scheme, model provider, isolation topology or evaluation methodology unless that decision is actually theirs and material now.

## 82.4 Settings interaction semantics

### Reversible low-risk preference

May apply immediately/autosave if:

- result is obvious;
- easily reversible;
- no material authority/data effect.

Show saved state non-intrusively.

### Material policy/configuration

Use explicit review + `Save changes` / `Apply policy`.

Before commitment show the material diff/consequence.

### Destructive/hard-to-reverse configuration

Use consequence-specific confirmation. Prefer recovery/undo where possible rather than confirmation fatigue.

## 82.5 Settings search

Authorized admins can search settings by **customer terms and synonyms**, including old/deep-link aliases during migration.

Search result shows:

- setting name;
- one-line purpose;
- Company section;
- whether access is restricted.

Search never grants access to a restricted route.

## 82.6 Deep links and support

Admin routes remain deep-linkable for authorized users so support/documentation can point to a specific control.

Hidden-from-navigation does not mean inaccessible or unauthorized.

---

# 83. Global content, microcopy, form, loading, error and recovery system

## 83.1 Writing doctrine

Use plain customer/task language.

Avoid technical architecture terminology unless the user is performing a technical/admin task.

## 83.2 Headings

H1 describes the current task/state/decision:

Good:
- `Connect HubSpot`
- `Review this workflow`
- `Your first result is ready`

Avoid:
- `Configuration`
- `Management`
- `Setup step`
- `Resource`

## 83.3 Action labels

Primary action = **verb + concrete outcome/object**.

Good:
- `Connect HubSpot`
- `Run first task`
- `Publish workflow`
- `Hire agent`
- `Pause agent`
- `Send feedback`

Avoid where a specific action is possible:
- `Submit`
- `Proceed`
- `OK`
- `Let's go`
- `Done`

## 83.4 Forms

- persistent visible labels;
- mark optional fields with `Optional` when useful;
- reuse known data;
- do not require repeated entry;
- prefill only when confidence/authority is sufficient;
- placeholder text is never the only label/instruction;
- helper text explains only what is needed to answer correctly;
- validate on an interaction cadence that does not punish incomplete typing.

## 83.5 Confirmation policy

Prefer direct action + undo/recovery for reversible changes.

Confirmation is reserved for material hard-to-reverse action, authority/data expansion, destructive effect, material spend/external communication, or where inherited domain policy requires it.

Confirmation copy states the **specific consequence**, not `Are you sure?`.

## 83.6 Loading/progress

- show loading only when work is actually pending;
- use skeleton only when content structure is meaningfully known;
- use progress steps/milestones when known;
- do not invent percentages;
- allow safe leave/resume for long-running work;
- preserve user input.

## 83.7 Error contract

Every user-facing material error answers:

```text
WHAT HAPPENED?
IS MY WORK / DATA SAFE?
WHAT CAN AUGUST WORKS STILL DO?
WHAT CAN I DO NOW?
```

Do not present provider/system failures as user validation mistakes.

## 83.8 Validation error behavior

- identify the specific field/problem;
- connect error text programmatically to the field;
- preserve all valid input;
- focus/scroll to an error summary or first invalid field according to form complexity;
- do not clear the form;
- give correction instructions, not blame.

## 83.9 Recovery

Offer only valid recovery actions:

- retry — safe/repeatable operation;
- reconnect — expired/missing external authorization;
- resume — durable interrupted work;
- refresh — stale projection;
- undo — reversible mutation;
- reconcile — unknown/ambiguous external outcome;
- contact support — exceptional recovery requiring human help.

## 83.10 Success / receipt

After consequential work, show durable enough evidence of:

- what happened;
- affected object;
- current state/version;
- next step or no-action-needed state;
- audit/receipt link when material.

Transient toast alone is insufficient for a result a user may need to reference later.

---

# 84. Enhanced accessibility and inclusive-interaction standard

## 84.1 Conformance floor and internal targets

- **WCAG 2.2 AA** remains the launch conformance floor.
- Selected AAA criteria are internal usability targets where applicable and controllable.
- V3 does not claim whole-product AAA conformance.

## 84.2 Pointer/touch targets

All custom primary, critical and frequently used controls SHOULD target **44 × 44 CSS px** minimum hit area where layout allows.

WCAG AA minimum requirements/exceptions remain the legal/conformance floor where a 44×44 target is not appropriate.

The global Feedback trigger uses the enhanced target by default.

## 84.3 Focus

- visible focus on every keyboard-operable control;
- focus is not fully obscured by sticky headers, drawers, dialogs or shell overlays;
- target the WCAG 2.2 Focus Appearance AAA size/contrast intent for key controlled components;
- never remove outline without an equivalent/better visible focus treatment.

## 84.4 Modal/dialog behavior

For modal flows such as Product Feedback:

- background interaction becomes inert;
- focus moves inside the dialog;
- Tab/Shift+Tab remain within;
- Escape closes unless a truly non-dismissable high-consequence operation is in progress;
- visible close/cancel exists;
- on close, focus returns to invoking Feedback control unless a more logical workflow target exists;
- initial focus is selected according to content, not mechanically always first button;
- never make the dialog container itself the ordinary focus target.

## 84.5 Dynamic status

Use semantic status/live-region behavior for relevant async changes that do not otherwise move focus.

Do not move focus to every toast/progress update.

## 84.6 Forms and errors

- semantic labels/instructions;
- required/optional communicated beyond color;
- errors linked to fields;
- form error summary for multi-error forms where it materially helps;
- preserve values on validation/system error.

## 84.7 Authentication

Allow password managers, paste and supported federated/SSO flows.

Do not introduce unnecessary memory/transcription/cognitive tests.

## 84.8 Non-pointer alternatives

Anything requiring drag/motion gesture has a keyboard/click/tap alternative unless the movement is essential to the task.

## 84.9 Zoom/reflow

Critical journeys, including onboarding, agent authoring, workflow authoring, governance and Feedback, are tested at 200% and 400% zoom/reflow where applicable.

No required action becomes unreachable behind fixed/sticky UI.

## 84.10 Motion

Respect reduced-motion preference.

Motion communicates state/continuity only when useful; no functional dependency on animation.

## 84.11 Data visuals/generative UI

Provide semantic text/table/structured equivalents for material charts/diagrams.

Typed Action Cards expose roles, names, states, consequences and actions programmatically.

## 84.12 Real assistive-technology evidence

Automated accessibility checks are necessary but insufficient.

Critical journeys require representative keyboard and screen-reader execution evidence before GA.

---

# 85. Customer Feedback & Product Improvement Loop

## 85.1 Product goal

> **Make it effortless for a customer to tell August Works what went wrong or what would make the product better, without forcing them to become support staff, QA engineers or product managers.**

Feedback is customer evidence used to improve future product outcomes. It is not:

- urgent support;
- a security vulnerability channel;
- an automatic roadmap vote;
- permission to collect arbitrary customer content;
- permission for AI to rewrite product truth.

## 85.2 Evidence synthesis behind the V3 design

Current high-quality/product-operational references converge on these mechanisms:

- Apple Feedback Assistant uses context-rich problem/enhancement reports, diagnostics/attachments, stable feedback IDs, follow-up and status.
- Microsoft Feedback Hub explicitly separates problem/suggestion feedback from help/support and supports optional screenshots/diagnostics.
- DfE research recommends feedback at the end of completed tasks and reports materially higher response after embedding feedback into completion pages; forms remain optional and urgent help is a different route.
- GOV.UK exposes page feedback broadly and asks contextual questions such as what the user was doing and what went wrong.
- Canny demonstrates useful product-management patterns such as categories and embedded collection, but a third-party public board is not required for the customer-facing mechanism.
- WCAG 2.2/WAI patterns support consistent placement, accessible target/focus/dialog behavior.

These patterns inform—but do not dictate—the exact August Works HOUSE implementation below.

## 85.3 Canonical architecture

Create one **August Works Customer Feedback** domain.

```text
GLOBAL / CONTEXTUAL ENTRY
→ Customer Feedback form
→ canonical feedback submission
→ receipt / customer-safe status
→ internal classification/enrichment
→ link to existing support/incident/issue/product work where needed
→ follow-up / resolution
→ product learning
```

Do **not** use:

- Paperclip Labs;
- Canny;
- GitHub Issues;
- a generic support ticket;
- PostHog events;

as the canonical customer-feedback source of truth.

External systems MAY receive redacted/authorized downstream projections/adapters later.

## 85.4 Persistent global entry

Every authenticated normal product surface exposes `Feedback` in the consistent global shell utility area from §77.

### Wide

Text-labelled `Feedback`.

### Collapsed/narrow

44×44 target in the persistent utility/header area with accessible name `Feedback`; a visible text label is preferred when space permits.

### Command layer

`Share feedback` is also a deterministic command in Ask/Cmd+K.

Do not require navigation to Settings.

Do not show an interrupting feedback modal automatically.

## 85.5 Contextual post-task feedback

In addition to the global trigger, V3 MAY show a small optional feedback affordance **after** selected completed customer journeys, not during the task:

launch defaults:

- first useful onboarding outcome;
- agent successfully hired/published;
- workflow successfully published;
- completed support recovery when suitable.

Example:

```text
How did this go?
[Good] [Needs improvement] [Tell us more]
```

This is non-modal and never blocks the success/receipt.

Launch HOUSE frequency guardrail:

- never more than one proactive post-task feedback prompt per user in a rolling 14-day period after the initial first-value prompt;
- dismissal suppresses the current prompt;
- configuration may be adjusted only from measured evidence, not by local component code.

The always-available global Feedback action is unaffected by sampling.

## 85.6 Feedback dialog

Title: `Share feedback`

Description:

`Tell us what went wrong or what would make August Works better. This isn't monitored for urgent support.`

Immediately below provide:

- `Need help now? Contact support`
- `Security or privacy concern? Report it securely`

These are links to their canonical recovery/reporting routes.

### Category

Single-select, customer language:

1. `Something isn't working` → `BUG`
2. `Something could be easier` → `IMPROVEMENT`
3. `I have an idea` → `IDEA`
4. `Other feedback` → `OTHER`

Do not ask the user to select an engineering team/component/severity taxonomy.

## 85.7 Dynamic feedback questions

### BUG

Required textarea label:

`What happened?`

Optional:
- `What were you trying to do?`
- checkbox `This stops me from completing my work`

Do not require reproduction steps before submission. Internal triage can request more information.

### IMPROVEMENT

Required:

`What could be easier or better?`

Optional:

`What were you trying to accomplish?`

### IDEA

Required:

`What would you like August Works to help you do?`

Optional:

`Why would this help?`

### OTHER

Required:

`What would you like us to know?`

## 85.8 Feedback form actions

Primary: `Send feedback`

Secondary: `Cancel`

Do not use multi-step Next/Back for the ordinary feedback form.

Changing category preserves compatible entered text.

## 85.9 Safe automatic context

Every submission may automatically include only allow-listed context necessary for triage:

```yaml
feedback_id:
company_id:
submitted_by_user_id: # omitted when "don't include my name" chosen
surface_key:
screen_contract_id:
route_template:       # no arbitrary query-string values
release_build_id:
timestamp:
locale:
timezone:
viewport_class:
browser_family_and_major_version:
os_family_and_major_version:
safe_error_code:
safe_correlation_id:
relevant_feature_flag_ids:
```

Do **not** automatically collect:

- raw URL query/fragment values;
- DOM/page text;
- prompt/conversation content;
- model output;
- tool input/output;
- clipboard;
- form values;
- documents/files;
- screenshots;
- session replay;
- secrets/tokens/credentials;
- unrelated recent user actions.

The dialog includes an expandable `Included automatically` disclosure showing the categories of safe context.

## 85.10 Technical diagnostics

Optional control, default **off**:

`Include technical diagnostics`

When enabled, only an approved structured diagnostic bundle may be attached.

The diagnostic schema is allow-listed and must not become a free-form log dump.

Example allowed classes:

- recent safe error codes;
- request/trace correlation IDs;
- connection/provider state codes;
- client/server release IDs;
- failed canonical operation identifiers.

Raw prompts/messages/files/secrets remain prohibited even when diagnostics are enabled unless a separate explicit support/security workflow requests them.

## 85.11 Attachments

Launch baseline supports optional **image attachments**:

- PNG;
- JPEG;
- WebP.

HOUSE limits:

- max 3 attachments;
- max 10 MiB each.

Every attachment:

- requires explicit user selection;
- has visible preview/name;
- can be removed before submission;
- is MIME/content validated;
- is malware/scanner processed as applicable;
- uses protected object storage;
- inherits tenant/RBAC and retention controls.

No automatic screenshot is captured at launch.

A future `Capture current page` capability requires a separate privacy/redaction acceptance package and must still show a preview before send.

## 85.12 Identity / name

Authenticated feedback includes the submitting user by default so the product team can ask for clarification.

Provide:

`Don't include my name in this feedback`

When selected:

- the canonical feedback submission omits `submitted_by_user_id` and direct contact fields;
- company/product context can remain where required for product triage;
- UI must explicitly explain that company and technical context may still be included;
- ordinary security/request logs remain governed by their separate retention purpose and must not be misrepresented as mathematically anonymous feedback.

Do not label this control `Anonymous` unless the end-to-end system has been verified to meet that stronger promise.

## 85.13 Submission and receipt

Do not show success until the canonical server accepts the submission.

Success state:

```text
Thanks — feedback received

Feedback ID: AWF-...
We'll use this to improve August Works.
If we need more information, we'll ask here.

[View my feedback]  [Close]
```

Do not promise that every submission receives a human response or roadmap commitment.

## 85.14 Session draft

While the feedback dialog is open/temporarily closed during the current browser session:

- preserve unsent text/category locally for a short session-scoped draft;
- do not sync the unsent draft to generic analytics;
- after successful send, clear it;
- explicit `Discard` clears it.

Do not create noisy persistent "feedback draft" notifications.

## 85.15 My Feedback

Provide a customer-safe `My feedback` view accessible from:

- submission receipt;
- account/help utility area;
- Feedback dialog/history link.

Customer statuses:

```text
RECEIVED
REVIEWING
NEEDS_INFO
RESOLVED
CLOSED
```

Show:

- Feedback ID;
- submitted date;
- category;
- original user text;
- attachments the user supplied;
- current status;
- product-team messages/questions;
- response field when `NEEDS_INFO`;
- resolution note/link where appropriate.

Do not expose:
- other customers' feedback;
- internal staff comments;
- security/internal issue details;
- uncommitted roadmap/confidential planning.

## 85.16 Internal triage lifecycle

Internal states may be more detailed:

```text
RECEIVED
→ CLASSIFIED
→ UNDER_REVIEW
→ ACTIONABLE | NEEDS_INFO | LINKED_DUPLICATE | CLOSED_NO_ACTION
→ RESOLVED_FIXED | RESOLVED_SHIPPED | RESOLVED_OTHER
```

A duplicate link preserves the original customer submission and can subscribe it to future relevant resolution updates.

Internal triage can link feedback to:

- product opportunity;
- engineering issue;
- incident;
- support case;
- usability research;
- roadmap hypothesis.

That linked work remains authoritative in its own domain; Customer Feedback does not become the project-management backend.

## 85.17 No public voting board by default

Do not expose customer feedback as a public/community voting board in V9 launch.

Reasons:

- enterprise/customer feedback can contain confidential context;
- popularity is not impact/priority;
- public status can create accidental product commitments;
- cross-customer visibility creates privacy/trust complexity.

A future public idea community requires a separate product/research/privacy decision.

## 85.18 Feedback evidence is self-selected evidence

Feedback volume does not estimate the whole customer population.

Do not use:

```text
most votes
most mentions
loudest account
```

as automatic priority.

Triage/prioritization considers:

- customer outcome blocked/improved;
- severity/consequence;
- reproducibility;
- affected customer/segment context;
- frequency across independent evidence;
- support burden;
- accessibility/security/privacy impact;
- strategic/product fit;
- workaround availability;
- measured product behavior;
- usability research;
- opportunity/cost.

## 85.19 AI-assisted feedback triage

AI MAY:

- classify category/theme;
- generate an internal concise summary;
- extract likely reproduction clues;
- cluster possible duplicates;
- suggest affected surface;
- draft a clarification question.

AI MUST NOT:

- rewrite the original submission;
- auto-close material feedback;
- promise roadmap delivery;
- message the customer with an unreviewed commitment;
- treat feedback text as system/tool instructions;
- execute tools because the feedback content told it to;
- expose another customer's report.

Feedback text/attachments are untrusted input and participate in prompt-injection defenses.

## 85.20 Canonical data model

### `customer_feedback_submissions`

```text
id uuid primary key
company_id uuid not null
submitted_by_user_id uuid nullable
category enum(BUG, IMPROVEMENT, IDEA, OTHER)
body text not null
goal_context text nullable
blocks_work boolean default false
identity_included boolean not null
surface_key text not null
screen_contract_id text nullable
route_template text nullable
release_build_id text not null
locale text nullable
timezone text nullable
viewport_class text nullable
browser_family text nullable
browser_major text nullable
os_family text nullable
os_major text nullable
safe_error_code text nullable
safe_correlation_id text nullable
safe_feature_context jsonb
diagnostics_included boolean default false
customer_status text not null
internal_status text not null
created_at timestamptz not null
updated_at timestamptz not null
```

Original customer-authored `body` / `goal_context` are immutable after submission except through an explicit customer-added follow-up/correction event; do not let triage enrichment overwrite them.

### `customer_feedback_attachments`

```text
id
feedback_id
object_key
media_type
size_bytes
sha256
scan_status
created_at
deleted_at
```

### `customer_feedback_events`

Append customer/internal workflow events:

```text
id
feedback_id
event_type
actor_type
actor_id nullable
customer_visible boolean
payload_json
created_at
```

### `customer_feedback_links`

Links feedback to an owning downstream object without transferring source-of-truth authority:

```text
feedback_id
target_domain
target_ref
link_type
created_at
```

## 85.21 API contract

Suggested canonical V9 endpoints:

```text
POST /companies/:id/feedback
GET  /companies/:id/feedback/mine
GET  /companies/:id/feedback/:feedbackId
POST /companies/:id/feedback/:feedbackId/replies
POST /companies/:id/feedback/:feedbackId/attachments
DELETE /companies/:id/feedback/:feedbackId/attachments/:attachmentId
```

AW-internal triage operations use protected operator/internal routes and roles; customer endpoints never accept internal triage fields.

Every write validates company/user authority and current feedback visibility.

## 85.22 Retention/deletion contract

Do not hardcode a legal retention number from UX convention.

Before GA, Privacy ownership MUST supply configured policy keys for:

- feedback submission retention;
- attachment retention;
- customer-visible conversation/follow-up retention;
- deletion/DSR behavior;
- incident/legal hold interaction;
- anonymized/aggregated learning retention.

GA fails if the required policies are unset.

## 85.23 Security controls

- CSRF/session protections according to auth architecture;
- tenant-scoped authorization on every read/write;
- rate/abuse limits;
- text stored/rendered as untrusted content;
- no executable HTML/script from submission;
- attachment type/size/content validation and scanning;
- protected object URLs;
- no cross-tenant search/autocomplete leakage;
- customer status never exposes internal issue metadata;
- internal triage RBAC;
- audit staff changes/status messages;
- feedback content cannot instruct triage agents/tools.

## 85.24 Accessibility contract

Global trigger:

- consistent relative location;
- accessible name `Feedback`;
- 44×44 target by launch default;
- keyboard reachable;
- visible focus.

Dialog:

- follows §84.4;
- single-select category is semantically grouped;
- visible labels;
- no placeholder-only prompt;
- attachment controls keyboard operable;
- errors programmatically associated;
- success announced without trapping focus;
- on close, focus returns to the invoking `Feedback` action;
- fully usable at 200/400% zoom/reflow;
- no screenshot/drag-only requirement.

## 85.25 Feedback metrics

Measure quality of the loop, not raw submission count:

- feedback form completion;
- feedback abandonment;
- median interaction time to submit (diagnostic, not target by itself);
- bug submissions sufficient for first triage without customer follow-up;
- `% NEEDS_INFO`;
- triage time;
- duplicate-cluster rate;
- feedback linked to verified defect/opportunity;
- time to customer-visible resolution where appropriate;
- follow-up burden on customer;
- status/update delivery success;
- feedback accessibility failure count;
- feedback privacy/security incident count (**launch target: zero material leakage**);
- product changes whose evidence package includes customer feedback plus independent evidence.

## 85.26 OutputFeedbackButtons migration

Repository baseline behavior:

`ui/src/components/OutputFeedbackButtons.tsx`
currently includes `Helpful` / `Needs work` and a sharing preference referring to **Paperclip Labs**.

V3 required migration:

1. remove Paperclip Labs branding/destination;
2. do **not** transfer an existing `Always allow`/sharing preference into consent to share content with August Works;
3. keep `Helpful` / `Needs work` as tenant-local AI-output quality/correction input by default;
4. `Needs work` may ask `What could have been better?` and offer `Correct output`;
5. raw prompt/output/company content is not sent to the August Works product team simply because the user votes;
6. if the user explicitly chooses `Send product feedback`, open the §85 form with a typed reference to the output;
7. attaching any output excerpt to product feedback requires an explicit preview/selection and product-feedback privacy contract;
8. remove the launch concept of silently sharing all future voted outputs with AW; persistent future raw-content sharing requires a later separate policy/product decision;
9. old Paperclip-oriented preferences are migrated to `needs_reconfirmation` / no AW sharing rather than silently reinterpreted.

This preserves valuable local correction while minimizing unnecessary product-team data exposure.

---

# 86. V3 no-guess release contract

## 86.1 Precedence

When implementation guidance conflicts:

```text
APPLICABLE EXTERNAL LAW / CONTRACT / DOMAIN STANDARD
→ V4–V8 CANONICAL AUTHORITY + SECURITY/PRIVACY INVARIANTS
→ V9 V3 ARCHITECTURE + EXACT EXPERIENCE CONTRACT
→ DESIGN SYSTEM / COMPONENT STANDARD
→ LOCAL IMPLEMENTATION CONVENIENCE
```

A lower layer cannot weaken a higher layer.

## 86.2 Required coverage before implementation freeze

The V3 coverage manifest includes at minimum:

- authentication/first organization;
- ONB-01–ONB-12;
- Home;
- Needs You;
- Work core journey;
- Apps/connect/reconnect;
- Hire Agent;
- Custom Agent;
- Agent detail/monitor/pause/retire;
- orchestration Advanced inspection;
- workflow create/test/publish/operate/change/recover/retire;
- Company/Settings areas in §82;
- permission/approval cards;
- Help/Support recovery;
- Customer Feedback;
- My Feedback;
- critical accessibility variants/states.

## 86.3 Definition of implementation-ready experience

`IMPLEMENTATION-READY / NO-GUESS` is earned when:

- every material journey has explicit customer outcome;
- screen/surface contracts exist;
- customer terminology is frozen;
- actions/confirmation/permission points are explicit;
- every async flow has loading/partial/stale/error/recovery/success semantics;
- every consequential action maps to canonical authority/versioning;
- every covered screen has keyboard/focus/screen-reader/responsive rules;
- analytics/privacy contracts specify allowed/prohibited data;
- acceptance evidence/test mapping exists.

## 86.4 What remains evidence-gated

Even after V3 specification:

- exact customer comprehension;
- actual time-to-first-value;
- customer preference among plausible IA/copy variants;
- population-level task-success rates;
- long-term trust/reliance calibration;
- real production support burden;
- feedback usage/quality;
- hosted runtime/provider/channel behavior;
- self-healing reliability under real operating conditions.

Those are validated through Waves 21–23 and post-deployment evidence.

## 86.5 Final V3 build directive

```text
DO NOT ask the coding agent to design August Works while implementing August Works.

IMPLEMENT:
- the V3 Screen Contracts;
- the canonical onboarding path;
- profile-specific daily navigation;
- contextual just-in-time permissions;
- packaged-agent and advanced custom-agent lifecycle;
- least-complex adequate orchestration;
- governed workflow draft/test/publish/operate/recover lifecycle;
- customer-first Company/Governance/Settings IA;
- global content/error/recovery/accessibility rules;
- native Customer Feedback with a real closed loop;
- tenant-local AI output correction without legacy Paperclip sharing;
- the inherited security/privacy/authority/evidence controls.

WHEN real user/production evidence falsifies a HOUSE default:
measure it,
record the evidence,
change the contract deliberately,
migrate safely,
and revalidate.
```

## 86.6 Current V3 verdict

```text
PRODUCT / EXPERIENCE DOCTRINE                 STRONG PASS
SECURITY / AUTHORITY / PRIVACY ARCHITECTURE  STRONG PASS
RELIABILITY / MAINTENANCE ARCHITECTURE       STRONG PASS
NO-GUESS EXPERIENCE SPECIFICATION            PASS AFTER V3
CUSTOMER FEEDBACK ARCHITECTURE                PASS AFTER V3
IMPLEMENTATION-READY BRIEF                    PASS
SYSTEM-TESTED                                 PENDING IMPLEMENTATION EVIDENCE
PRODUCTION-VALIDATED                          PENDING FIELD + V6/V7 EVIDENCE
```

V3 is the strongest defensible pre-build specification: external evidence supplies the human-centred constraints; August Works supplies explicit product defaults; implementation supplies verified behavior; field evidence decides whether those defaults survive reality.


---

## End of Master Build Brief v9.0 — Research-Audited, Security-Overlaid, Assurance-Hardened & Experience-Specified Golden Master v3
