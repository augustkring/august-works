# Master Playbook Standard

> **Evidence-Based Standard for Researching, Designing, Validating,
> Operating, and Improving Playbooks**

``` yaml
document_id: MPS-001
title: Master Playbook Standard
version: 2.0-RC1
status: REVIEWED
created: 2026-09-22
last_updated: 2026-09-27
last_reviewed: 2026-09-27
evidence_cutoff: 2026-09-27
canonical_language: English
owner: TBD
review_cadence: risk-and-volatility-based
next_scheduled_review: 2026-12-27
supersedes: 1.0-RC2
applies_to:
  - master playbooks
  - domain playbooks
  - operating playbooks
  - execution playbooks
  - decision playbooks
  - discovery playbooks
  - response playbooks
  - capability playbooks
  - plays
  - runbooks
  - SOPs
  - checklists
  - templates
  - human+AI executable playbooks
```

**Status note.** Version 2.0-RC1 is the research-reviewed successor to
v1.0-RC2. It incorporates an expanded 2026 sanity audit covering
quality-management auditing, implementation science, evaluation design,
human factors, evidence-synthesis methodology, knowledge management, and
AI evaluation/monitoring. The three RC2 cross-domain pilots remain
useful prior evidence, but V2 introduces material architecture changes
and is therefore reset to `REVIEWED`. It MUST be re-tested through
representative cross-domain and non-author execution before it can
progress to `TESTED` or `VALIDATED`.

------------------------------------------------------------------------

## Executive standard

A playbook is not a long document about a topic. It is an **operational
knowledge system that converts trustworthy knowledge into
context-sensitive decisions, repeatable actions, verifiable outputs, and
learning**.

The core chain is:

> **Outcome → Evidence → Decision → Action → Implementation →
> Verification → Evaluation → Learning**

A high-quality playbook therefore does eight things:

1.  defines the real outcome, users, context, and boundaries before
    prescribing work;
2.  explains the principles that should remain stable when tactics
    change;
3.  builds recommendations from fit-for-question evidence and explicit
    uncertainty rather than source prestige;
4.  makes assumptions, causal logic, alternatives, and decision points
    explicit where they materially affect outcomes;
5.  turns selected decisions into executable plays, runbooks,
    checklists, tools, or machine-readable controls;
6.  designs for competence, adoption, local context, and sustainable use
    — not publication alone;
7.  verifies the artifact and evaluates implementation and real-world
    outcomes with proportionate methods; and
8.  captures evidence, exceptions, failures, and lessons so the
    operating system improves over time.

This standard is intentionally **modular rather than
one-size-fits-all**. NIST explicitly treats a playbook as a resource to
tailor rather than an ordered checklist, while Stanford’s d.school warns
against treating complex work as one universal linear process. ISO
documentation guidance likewise calls for documented information to be
tailored to organizational needs rather than forced into one prescribed
hierarchy. \[S05\] \[S06\] \[S19\] \[S20\] \[S02\]

The standard is **risk-proportionate**. The amount of evidence,
documentation, review, testing, control, and approval required MUST
increase with consequence, irreversibility, uncertainty, complexity,
regulatory exposure, security/privacy impact, and blast radius. This
principle is consistent with ISO’s risk-based quality-management
approach and NASA’s use of more formal decision analysis and
verification when stakes, uncertainty, and complexity are higher.
\[S01\] \[S14\]

The standard is also **evidence-aware rather than authority-driven**. No
consultancy, university, vendor, or framework becomes “best practice”
merely because of its brand. Claims SHOULD be triangulated across the
best available scientific research, organizational data, professional
expertise, stakeholder evidence, authoritative standards, and relevant
operational experience. Evidence-Based Management explicitly treats
multiple evidence sources as complementary and requires critical
appraisal before use. \[S16\]

------------------------------------------------------------------------

# 1. Purpose

The Master Playbook Standard exists to make playbooks:

- **correct enough for their risk level;**
- **clear enough to execute;**
- **adaptive enough for real contexts;**
- **traceable enough to audit;**
- **testable enough to trust;**
- **maintainable enough to remain useful;**
- **structured enough for both humans and AI systems to navigate.**

It standardizes **how playbooks are made**, not the subject matter of
any specific playbook.

It governs:

- scoping;
- classification;
- research;
- evidence appraisal;
- synthesis;
- information architecture;
- decision design;
- play construction;
- runbook construction;
- verification;
- validation;
- release;
- measurement;
- maintenance;
- deprecation.

It does **not** claim to be:

- an ISO certification;
- a substitute for legal, regulatory, medical, security, financial, or
  other specialist requirements;
- a universal linear process for every domain;
- a guarantee that a recommendation is correct;
- a license to turn contextual judgment into rigid procedure.

Where an applicable law, regulation, contractual requirement, platform
rule, safety standard, or domain-specific standard conflicts with this
document, the applicable external requirement takes precedence.

------------------------------------------------------------------------

# 2. Research basis and design philosophy

## 2.1 Evidence base used for this release

This release triangulates six source families:

| Source family                                              | Role in this standard                                                                                          | Examples                                                          |
|------------------------------------------------------------|----------------------------------------------------------------------------------------------------------------|-------------------------------------------------------------------|
| International and public standards                         | Quality, documentation, knowledge management, risk, normative language                                         | ISO, NIST, IETF, CISA                                             |
| High-reliability engineering and systems practice          | Verification, validation, decision rigor, risk, traceability                                                   | NASA                                                              |
| Mature operational excellence                              | Runbooks, playbooks, ownership, incident learning, testing, versioning                                         | Google SRE, AWS, Microsoft Azure                                  |
| Evidence and review methodology                            | Critical appraisal, multi-source evidence, transparent research                                                | CEBMa, PRISMA                                                     |
| Academic/design/learning institutions                      | Ambiguity, human-centered design, experimentation, organizational learning, decision framing                   | Stanford d.school, Harvard/HBR, Wharton                           |
| Applied management and practitioner frameworks             | Operating models, decision rights, capability building, practical play design                                  | McKinsey, Bain, Atlassian, Strategyzer, Lean Enterprise Institute |
| Guideline and evidence-to-decision methodology             | Evidence certainty, recommendation formulation, stakeholder involvement, applicability, editorial independence | GRADE/Cochrane, NICE, AGREE II                                    |
| Human factors, checklist implementation, and accessibility | Cognitive load, clear instructions, local adaptation, training, adoption, inclusive usability                  | FAA, WHO, W3C WAI                                                 |
| Process and knowledge architecture                         | Common process language, decomposition, process ownership, measures, maintainability                           | APQC, ISO 30401                                                   |
| Implementation science and behavior change                 | Context determinants, adoption, fidelity/adaptation, sustainment, implementation outcomes                      | CFIR, RE-AIM/PRISM, Proctor taxonomy, JBI                         |
| Evaluation and causal learning                             | Theory of change, process/impact/value evaluation, unintended outcomes, proportional evaluation                | UK Magenta Book 2026, Green Book                                  |
| Audit and independent assurance                            | Audit principles, competence, independence, evidence, audit-program design                                     | ISO 19011:2026, National Academies                                |
| Evidence-synthesis methods                                 | Review-type selection, reproducible searching, search peer review, method-specific appraisal                   | Cochrane, JBI, PRISMA-S, PRESS                                    |
| AI assurance and machine-execution controls                | TEVV, human oversight, provenance, adversarial testing, post-deployment monitoring, agent/tool controls        | NIST AI RMF/AI 600-1, OWASP, SLSA                                 |

These families do **not** form a universal ranking. A primary platform
specification may be the best source for an API constraint; a randomized
or high-quality synthesis may be best for a causal human-behavior claim;
internal performance data may be best for deciding whether a workflow
works in a specific company.

## 2.2 Method used to construct and audit v2.0-RC1

The V2 research process used a structured, question-driven
evidence-synthesis and standards-audit logic. It was not a formal
systematic review, but it deliberately borrowed reproducibility and
critical-appraisal controls from evidence-synthesis methodology:

1.  define the questions the standard must answer;
2.  identify authoritative source families;
3.  prioritize primary and official sources;
4.  retrieve current versions;
5.  extract relevant principles;
6.  compare overlapping recommendations;
7.  search for contradictions and limits;
8.  distinguish universal principles from context-dependent methods;
9.  synthesize into operational rules;
10. document important watch items and unresolved areas.

PRISMA 2020 and PRISMA-S were used as **inspiration for research
transparency**, search traceability, and inclusion/exclusion discipline.
This document does **not** claim that its research process is a formal
systematic review or PRISMA-compliant review. \[S17\] \[S18\]

## 2.3 High-confidence findings from the source review

The strongest recurring findings across independent source families are:

1.  **Start from intended outcomes and context.**
2.  **Do not force complex work into one rigid sequence.**
3.  **Make processes, roles, inputs, outputs, and criteria explicit.**
4.  **Match process rigor to risk, complexity, and uncertainty.**
5.  **Separate routine known-path procedures from investigative or
    judgment-heavy work.**
6.  **Use evidence critically; do not confuse popularity or authority
    with validity.**
7.  **Verify the artifact and validate it with actual users or realistic
    scenarios.**
8.  **Have someone other than the author execute or challenge
    operational instructions.**
9.  **Maintain ownership, version control, review dates, and change
    history.**
10. **Build feedback and learning into the operating model.**
11. **Document exceptions, failure modes, escalation, and recovery where
    consequences justify it.**
12. **Keep standards stable enough for consistency but adaptable enough
    for improvement.**
13. **Separate evidence certainty from recommendation strength and
    implementation choice.**
14. **Assess applicability: feasibility, resources, stakeholder
    acceptability, barriers, and local context can change the right
    action.**
15. **Make conflicts, incentives, and editorial independence visible for
    material recommendations.**
16. **Design implementation, training, and adoption into the playbook
    rather than assuming publication changes behavior.**
17. **Treat human factors and accessibility as reliability concerns,
    especially for instructions used under pressure or by mixed-skill
    users.**
18. **For AI/agent execution, pre-deployment testing is insufficient by
    itself; define permissions, side-effect controls, observability, and
    post-deployment monitoring.**

These findings appear in different vocabulary across ISO, NIST, NASA,
AWS, Microsoft, Google SRE, evidence-based management, and
design/learning sources. \[S01\] \[S02\] \[S05\] \[S09\] \[S10\] \[S11\]
\[S12\] \[S14\] \[S16\] \[S19\]

------------------------------------------------------------------------

# 3. Foundational principles

Every artifact governed by this standard SHOULD be designed around the
following principles.

## Quality model

A playbook is not “good” on one dimension. Its quality SHOULD be
considered across at least the following attributes:

| Attribute                       | Question                                                                                                                                        |
|---------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------|
| **Validity**                    | Are material claims and recommendations sufficiently correct for the risk level?                                                                |
| **Fitness for purpose**         | Does the artifact solve the real user/problem it was designed for?                                                                              |
| **Executability**               | Can an appropriate user translate it into action without hidden assumptions?                                                                    |
| **Reliability**                 | Does it produce sufficiently consistent results where consistency is intended?                                                                  |
| **Adaptability**                | Can it handle legitimate context variation without forcing false uniformity?                                                                    |
| **Safety / control**            | Are material risks, boundaries, failures, and escalation handled proportionately?                                                               |
| **Usability**                   | Can users find, understand, navigate, and apply the right part at the right time?                                                               |
| **Traceability**                | Can claims, decisions, versions, ownership, and changes be traced?                                                                              |
| **Maintainability**             | Can the system be updated without uncontrolled duplication or breakage?                                                                         |
| **Learnability**                | Does real-world use feed back into improvement?                                                                                                 |
| **Efficiency**                  | Does the artifact impose no more process/documentation burden than its value and risk justify?                                                  |
| **Implementability**            | Can the intended organization actually adopt it with available skills, resources, incentives, tools, and operating constraints?                 |
| **Effectiveness / impact**      | Does use of the playbook contribute to the intended real-world outcome rather than merely producing compliant activity or artifacts?            |
| **Sustainability**              | Can the capability remain effective as people, evidence, systems, incentives, and context change?                                               |
| **Assurability**                | Can an appropriately independent reviewer reconstruct why the guidance exists, how it was tested, and whether required controls were satisfied? |
| **Accessibility / inclusivity** | Can intended users, including users with relevant disabilities or language/cognitive constraints, perceive, navigate, understand, and apply it? |
| **Independence / integrity**    | Are material recommendations protected from undisclosed conflicts, incentives, source laundering, or inappropriate funder/vendor influence?     |

These attributes can conflict. More control can reduce speed; more
completeness can reduce usability; more flexibility can reduce
consistency. The playbook designer MUST manage the trade-offs rather
than maximize one attribute blindly.

This quality model is a `HOUSE` synthesis derived from the source
review. It is not presented as an external certification model.

## P01 — Outcome before output

A playbook MUST define the outcome it exists to enable before defining
its chapters, tools, or procedures.

A completed document is not the outcome.

Bad:

> Create a 60-page market-validation playbook.

Better:

> Enable a venture team to identify, prioritize, and test the
> assumptions that could invalidate a business opportunity before
> disproportionate resources are committed.

The distinction matters because documentation can be complete while the
operating capability is absent.

## P02 — Context before prescription

A recommendation SHOULD state the context in which it applies.

Avoid:

> Always interview 20 customers.

Prefer:

> For exploratory qualitative discovery, interview until the research
> question is sufficiently informed and material themes are no longer
> changing decisions; sample design and sufficiency depend on user
> heterogeneity, research objective, and consequence of error.

The more contextual the domain, the more the playbook SHOULD encode
judgment logic rather than false universal rules.

## P03 — Principles before tactics

Stable principles SHOULD be separated from volatile tactics.

A platform setting can change next week. A principle such as “measure
incremental outcome rather than vanity output” is more durable.

This reduces maintenance cost and prevents users from confusing one
implementation with the underlying logic.

## P04 — Decision before data

For decision-oriented work, define the decision and its alternatives
before collecting arbitrary data.

NASA’s decision-analysis logic emphasizes intended outcomes, criteria,
alternatives, uncertainty, and documented rationale. Wharton material on
decision-driven analytics similarly argues for working backward from the
decision rather than beginning with whatever data happens to be
available. \[S14\] \[S30\]

## P05 — Evidence before assertion

Material claims MUST be traceable to evidence, explicit experience,
organizational data, or a clearly labeled house judgment.

A recognizable logo beside a claim is not sufficient evidence.

## P06 — Proportional rigor

Documentation and validation MUST be proportionate to consequence.

A reversible copy experiment does not need the same controls as a
production security change, financial control, hiring decision, medical
workflow, or destructive data migration.

## P07 — Modularity before monolith

A playbook SHOULD be composed of reusable modules that can be navigated
by need.

NIST’s AI RMF Playbook explicitly rejects the assumption that all users
should follow every suggestion in sequence. \[S05\] \[S06\]

## P08 — Progressive disclosure

Users SHOULD be able to get the right level of detail without reading
everything.

Recommended layers:

1.  orientation;
2.  decision logic;
3.  execution detail;
4.  evidence/reference detail.

## P09 — Explicit judgment

Where competent judgment is required, say so.

Do not convert a nuanced decision into a fake algorithm simply because a
checklist is easier to document.

## P10 — Verification before trust

An artifact SHOULD not be treated as production-ready merely because it
looks complete.

Operational instructions SHOULD be dry-run by someone other than the
author when material risk or repeated use justifies it. AWS explicitly
recommends this for runbooks and playbooks. \[S09\] \[S10\]

## P11 — Validation with reality

Verification asks whether the artifact was constructed correctly.

Validation asks whether it is the right artifact for the real user’s
need and operating environment.

This distinction mirrors NASA’s systems-engineering separation of
verification and validation. \[S14\]

## P12 — Learn through use

A playbook is a living system.

Usage data, exceptions, failures, user confusion, new evidence, platform
changes, and outcome data SHOULD feed future revisions.

ISO quality management emphasizes performance evaluation and continual
improvement, while Google SRE uses incident learning and postmortems to
change systems rather than merely document failures. \[S01\] \[S13\]

## P13 — One owner, many contributors

Every production playbook MUST have an accountable owner.

Contributors can be distributed. Accountability cannot be ambiguous.

## P14 — Clear decision rights

Where execution crosses teams or roles, decision authority and
escalation SHOULD be explicit.

Bain’s RAPID framework, Wharton material on autonomy, and modern
operating-model practice all reinforce the value of clarity about who
recommends, contributes, decides, executes, or must be consulted.
\[S25\] \[S31\] \[S23\]

## P15 — Standards are baselines, not prisons

Standardization exists to reduce avoidable variance and preserve
learning.

It MUST NOT block legitimate adaptation, experimentation, or
improvement.

Microsoft explicitly warns against making operational standards so rigid
that they suppress evolution; Lean standardized work similarly treats
the current standard as a baseline for improvement rather than a
permanent endpoint. \[S11\] \[S29\]

## P16 — Evidence does not equal recommendation

Strong evidence about an effect does not automatically determine what an
organization SHOULD do.

Material recommendations SHOULD also consider, as relevant: expected
benefits and harms; stakeholder values and preferences; feasibility;
resource/cost implications; acceptability; accessibility/equity;
alternatives and opportunity cost; reversibility; implementation
barriers; and uncertainty.

This is an adapted cross-domain lesson from GRADE/NICE
evidence-to-decision practice and AGREE II applicability criteria.
\[S35\] \[S36\] \[S37\] \[S38\]

## P17 — Design for adoption, not publication

A playbook is not implemented because it was published.

Where adoption matters, the design SHOULD address who must change
behavior, baseline competence, training/coaching, local barriers and
facilitators, local adaptation within protected invariants,
ownership/champions, rollout strategy, feedback, resource implications,
and retirement of conflicting old guidance.

WHO checklist implementation guidance and AGREE II both treat
implementation conditions as part of quality, not an afterthought.
\[S34\] \[S38\]

## P18 — Human factors are system factors

Errors caused by unclear wording, excessive memory demand, ambiguous
sequencing, inaccessible presentation, or poor handoffs are design
defects, not merely user defects.

Critical instructions SHOULD minimize avoidable cognitive load, use
clear stepwise language, expose state and expected results, and be
tested with representative users. FAA human-factors guidance requires
professional judgment rather than blind compliance, while W3C guidance
emphasizes clear, understandable, structured instructions. \[S33\]
\[S40\]

## P19 — Independence and incentives must be visible

For material recommendations, authors SHOULD disclose relevant
conflicts, funding/vendor interests, and incentives that could bias
source selection or recommendation formulation.

Higher-rigor work SHOULD use an appropriately independent reviewer and
document how material conflicts were handled. AGREE II explicitly treats
editorial independence and competing interests as a quality domain.
\[S38\]

## P20 — Automation raises the control bar

When a playbook can trigger software, AI agents, or other automated
actions, ambiguity can become executable behavior at scale.

Machine-executable Plays SHOULD define stronger controls for
authorization and least privilege; trusted vs untrusted inputs;
preconditions/postconditions; side-effect/reversibility class; approval
boundaries; schema validation; retries/timeouts/recursion limits;
idempotency/concurrency where relevant; logging/provenance;
monitoring/anomaly handling; and kill/stop/recovery paths.

NIST emphasizes TEVV, human oversight, adversarial testing, and
post-deployment monitoring for AI systems; OWASP provides complementary
applied agent-security controls. \[S41\] \[S42\] \[S43\]

## P21 — Model the path from action to outcome

When a playbook claims that a set of actions should improve an outcome,
the material causal chain SHOULD be explicit enough to challenge.

For complex or high-impact work, identify:

- the problem or opportunity;
- intended users/beneficiaries;
- inputs and actions;
- expected intermediate changes;
- intended outcomes;
- assumptions and dependencies;
- plausible alternative explanations;
- important unintended effects;
- evidence supporting the critical links.

This need not become a large diagram. The purpose is to expose the
assumptions that would otherwise remain hidden. The UK Magenta Book 2026
treats a Theory of Change as a core mechanism for exposing causal
pathways, assumptions, context, and alternative explanations before and
during evaluation. \[S50\]

## P22 — Separate intervention quality from implementation quality

A good recommendation can fail because it is poorly implemented. A weak
recommendation can appear successful because implementation metrics are
mistaken for outcome metrics.

Where adoption matters, distinguish at least:

1.  **intervention/play quality** — is the guidance itself sound?;
2.  **implementation quality** — was it adopted, feasible, acceptable,
    and used with appropriate fidelity/adaptation?;
3.  **service/process outcome** — did the operating process improve?;
    and
4.  **business/user outcome** — did the intended real-world result
    improve?

Implementation-science frameworks such as CFIR, RE-AIM/PRISM, and the
Proctor implementation-outcomes taxonomy make these distinctions
explicit. Their full health-domain frameworks are not imported
wholesale; the cross-domain principle is that implementation has
determinants and outcomes of its own. \[S51\] \[S52\] \[S53\]

## P23 — Procedures support competence; they do not replace it

A procedure, checklist, or AI instruction MUST NOT be used as a
substitute for skills, authorization, judgment, supervision, or training
that the task itself requires.

For material procedures, define the assumed competence level and
identify when training, rehearsal, certification, pairing, or expert
escalation is required. HSE explicitly treats procedures and competence
as complementary controls, while NASA human-systems guidance uses task
analysis and human-in-the-loop evaluation to inform procedures and
training. \[S54\] \[S55\]

## P24 — Trace from requirement to evidence to execution to outcome

For R3/R4 work, material requirements and recommendations SHOULD be
traceable through the chain that makes them trustworthy:

> **Requirement / claim → evidence → recommendation → Play/control →
> test → observed result → update**

Traceability is not paperwork for its own sake. It allows reviewers to
detect orphan requirements, unsupported recommendations, untested
controls, stale evidence, and tests that no longer correspond to current
behavior. NASA uses verification and validation matrices to connect
requirements to verification and validation methods. \[S14\]

## P25 — Choose the evidence-synthesis method to fit the question

A systematic review, scoping review, rapid review, qualitative
synthesis, benchmark analysis, incident review, expert elicitation, or
internal experiment answers different questions and carries different
limitations.

Research rigor MUST NOT be represented by source count or by forcing
every question into one review design. JBI explicitly maintains multiple
evidence- synthesis methodologies because different questions require
different evidence forms. \[S60\]

## P26 — Audit the operating system, not only the document

A document can conform to a template while the real operating capability
fails. Audits SHOULD therefore sample evidence of actual use,
competence, controls, exceptions, outcomes, and improvement — not merely
section presence.

For higher-rigor playbooks, audit planning SHOULD consider reviewer
competence, independence, objective evidence, sampling, and follow-up.
ISO 19011:2026 provides the current international guidance for
management-system auditing. \[S49\]

------------------------------------------------------------------------

# 4. Artifact hierarchy and terminology

A recurring source of weak playbooks is category confusion. This
standard uses the following canonical hierarchy.

``` text
MASTER PLAYBOOK STANDARD
        ↓
DOMAIN / CAPABILITY PLAYBOOK
        ↓
PLAY
        ↓
RUNBOOK / SOP
        ↓
CHECKLIST / TEMPLATE / TOOL
        ↓
REFERENCE / EVIDENCE / EXAMPLE
```

## 4.1 Master Playbook Standard

**Purpose:** defines how playbooks themselves are created and governed.

Contains:

- construction rules;
- research rules;
- evidence rules;
- validation rules;
- governance rules;
- canonical templates.

It SHOULD remain domain-agnostic.

## 4.2 Domain or Capability Playbook

**Purpose:** provides an operating system for a substantial field or
capability.

Examples:

- Software Engineering
- Google Ads
- Brand Positioning
- Market Validation
- Business Design
- Incident Response
- AI Agent Engineering

It typically contains:

- principles;
- domain model;
- decision logic;
- end-to-end operating model;
- multiple plays;
- selected runbooks/templates;
- measurement and learning.

## 4.3 Play

**Purpose:** handles a recurring situation, decision, challenge, or
outcome.

A play is the core operational unit of a playbook.

Examples:

- Validate a problem hypothesis
- Select a deployment strategy
- Diagnose declining campaign performance
- Define a brand positioning hypothesis
- Respond to a production severity-1 incident

A play can contain branches, choices, heuristics, and judgment.

## 4.4 Runbook

**Purpose:** execute a known path to a specific operational outcome.

AWS defines a runbook as a documented sequence used to achieve a
specific outcome and recommends including permissions, error handling,
exceptions, escalation, ownership, and validation by another operator.
\[S09\]

Use a runbook when:

- the trigger is known;
- the path is substantially known;
- the actions are repeatable;
- consistency matters;
- branching is bounded;
- the procedure can be tested.

## 4.5 Standard Operating Procedure (SOP)

For this system, an SOP is a controlled procedural artifact that
specifies how a repeatable process MUST or SHOULD be performed.

A runbook is usually more execution-specific; an SOP can be broader and
may govern recurring business processes, compliance controls, quality
procedures, or operating routines.

Do not obsess over the label if the operational distinction is clear.

## 4.6 Checklist

A checklist is a compact verification or execution aid.

A checklist:

- MUST NOT carry more context than the user can reliably scan;
- SHOULD contain discrete, observable items;
- SHOULD point to a play/runbook when judgment or explanation is needed.

A checklist is not a substitute for a playbook.

## 4.7 Template

A template structures an output.

It SHOULD:

- make required information obvious;
- avoid forcing irrelevant fields;
- embed quality criteria where useful;
- support consistent downstream review.

## 4.8 Tool

A tool is an executable aid such as:

- calculator;
- decision table;
- scoring worksheet;
- script;
- prompt;
- automation;
- diagnostic;
- canvas;
- form.

A tool MUST NOT hide assumptions that materially affect the decision.

## 4.9 Reference material

Reference material helps users understand or look up information but is
not itself an execution artifact.

Examples:

- glossary;
- source register;
- background theory;
- benchmark library;
- examples;
- FAQ.

## 4.10 Terminology is domain-dependent

There is no single externally standardized definition of `playbook`,
`runbook`, and `play` across every field.

For example:

- AWS operational guidance commonly distinguishes runbooks for known
  procedures from playbooks used to investigate issues. \[S09\] \[S10\]
- NIST’s AI RMF Playbook is a modular set of suggested actions that
  users tailor and is explicitly not an ordered checklist. \[S05\]
  \[S06\]
- Atlassian uses `Play` for a tactical, facilitated exercise with
  preparation, instructions, and actionable outcomes. \[S27\]

Therefore, the hierarchy in this document is a `HOUSE` taxonomy designed
to make our own system internally coherent.

When interfacing with an external standard or team, authors MUST
preserve or explain the external terminology where changing it could
cause misunderstanding.

------------------------------------------------------------------------

# 5. Playbook archetypes

No single content structure fits all playbooks. Select a primary
archetype and any secondary archetypes during scoping.

| Archetype      | Primary question                                              | Typical uncertainty | Dominant artifact                          |
|----------------|---------------------------------------------------------------|--------------------:|--------------------------------------------|
| **Operating**  | How do we run this capability continuously?                   |              Medium | Operating model + recurring plays          |
| **Execution**  | How do we produce this outcome reliably?                      |          Low–medium | Play + runbooks                            |
| **Decision**   | How do we choose well among alternatives?                     |         Medium–high | Criteria + decision logic + record         |
| **Discovery**  | How do we reduce uncertainty?                                 |                High | Hypotheses + experiments + synthesis       |
| **Response**   | How do we respond under time pressure or abnormal conditions? |       Variable/high | Trigger + roles + branching + escalation   |
| **Capability** | How do we build and improve this organizational ability?      |              Medium | Principles + practices + maturity/learning |
| **Hybrid**     | Multiple of the above                                         |               Mixed | Modular combination                        |

## 5.1 Operating playbook

MUST define:

- purpose;
- boundaries;
- operating cadence;
- roles;
- core workflows;
- key decisions;
- controls;
- measures;
- improvement loop.

## 5.2 Execution playbook

MUST emphasize:

- inputs;
- sequence/logic;
- deliverables;
- acceptance criteria;
- quality controls;
- failure handling.

## 5.3 Decision playbook

MUST emphasize:

- decision statement;
- decision owner;
- alternatives;
- criteria;
- evidence;
- trade-offs;
- uncertainty;
- escalation;
- rationale/record.

## 5.4 Discovery playbook

MUST emphasize:

- uncertainty;
- hypotheses;
- assumptions;
- evidence thresholds;
- experiments;
- learning;
- iteration;
- stop/pivot/continue logic.

Strategyzer’s testing guidance is useful here: articulate testable
assumptions, prioritize critical uncertainty, choose experiments with
attention to evidence strength, time, and cost, and update decisions as
evidence accumulates. These are **discovery-specific practices**, not
universal rules for every playbook. \[S28\]

## 5.5 Response playbook

MUST emphasize:

- trigger;
- severity/priority;
- immediate objectives;
- roles and communication;
- triage;
- branching investigation;
- escalation;
- recovery;
- handoff;
- learning afterward.

Google SRE, CISA, and NIST incident-response guidance provide strong
examples of preparation, repeatable response structures, coordination,
recovery, and learning. \[S07\] \[S12\] \[S15\]

## 5.6 Capability playbook

MUST emphasize:

- capability outcome;
- people;
- process;
- technology/tools;
- routines;
- governance;
- learning;
- measures.

McKinsey’s applied work is useful as secondary evidence here because it
treats institutional capability as an integration of people, processes,
technology, roles, and routines rather than a document or training event
alone. \[S23\] \[S24\]

------------------------------------------------------------------------

# 6. Normative language

This standard adopts the clarity principle behind IETF BCP 14 / RFC
8174: uppercase requirement terms have deliberate meanings. \[S08\]

## 6.1 Requirement words

**MUST / MUST NOT**  
A mandatory rule within this house standard. Deviation requires an
explicit exception, rationale, owner, and—where material—risk
acceptance.

**SHOULD / SHOULD NOT**  
A strong default. Deviation is permitted when context makes another
choice better, but the reason SHOULD be knowable.

**MAY**  
An optional technique or artifact.

**JUDGMENT REQUIRED**  
A marker that context-sensitive competent judgment is necessary and the
playbook intentionally does not prescribe one deterministic answer.

## 6.2 Important distinction

Normative strength is not evidence strength.

Example:

> **MUST** record the source of a high-impact external factual claim.

This is a house requirement. It does not mean that the underlying source
is high quality.

Conversely:

> A high-quality meta-analysis finds X.

This can be strong evidence without creating a mandatory action.

------------------------------------------------------------------------

# 7. Claim taxonomy

Every material recommendation SHOULD be classifiable.

| Label   | Meaning                                                   | Example                                                                  |
|---------|-----------------------------------------------------------|--------------------------------------------------------------------------|
| `REQ`   | External requirement that applies in the stated context   | Regulation, contractual rule, platform requirement                       |
| `EST`   | Well-established practice supported across strong sources | Version control for controlled operational documentation                 |
| `DEF`   | Recommended default                                       | Have another operator dry-run a material runbook                         |
| `CTX`   | Context-dependent practice                                | Use interviews before quantitative testing in a poorly understood domain |
| `EMG`   | Emerging practice with incomplete evidence                | New AI-agent orchestration convention                                    |
| `HOUSE` | Deliberate internal design choice                         | Stable Play IDs in all files                                             |
| `EXP`   | Experiment to test                                        | New automated QA gate                                                    |
| `UNK`   | Important unresolved question                             | Threshold cannot yet be justified                                        |

### Rules

- `REQ` MUST cite the authority and applicability condition.
- `EST` SHOULD have corroboration from more than one strong source
  family where feasible.
- `DEF` MUST state important exceptions when known.
- `CTX` MUST state boundary conditions.
- `EMG` MUST NOT be represented as proven.
- `HOUSE` MUST NOT be disguised as external best practice.
- `EXP` SHOULD have a test and decision rule.
- `UNK` SHOULD remain visible if the uncertainty matters.

------------------------------------------------------------------------

# 8. Evidence standard

## 8.1 Core principle

Evidence quality is not the same as source prestige.

The evidence process SHOULD follow an adapted version of the
Evidence-Based Management sequence:

> **Ask → Acquire → Appraise → Aggregate → Apply → Assess** \[S16\]

## 8.2 Four evidence families

For organizational and operational decisions, consider four
complementary evidence families where relevant:

1.  **Scientific/research evidence**
    - peer-reviewed studies;
    - systematic reviews;
    - meta-analyses;
    - credible academic syntheses.
2.  **Organizational evidence**
    - internal performance data;
    - customer data;
    - incident data;
    - experiment results;
    - operational logs;
    - financial or process metrics.
3.  **Professional/practitioner evidence**
    - experienced operators;
    - implementation patterns;
    - expert judgment;
    - mature engineering practice;
    - documented cases.
4.  **Stakeholder evidence**
    - customer needs;
    - employee experience;
    - user research;
    - partner constraints;
    - affected stakeholder preferences and concerns.

For rules and controlled environments, a fifth category is critical:

5.  **Authoritative requirements**
    - law/regulation;
    - official standards;
    - platform/vendor specifications;
    - contractual obligations;
    - security policies.

These categories answer different questions. Do not average them
mechanically.

## 8.3 Source classes

Source class describes provenance, not automatic truth.

| Class | Source type                                                        | Typical use                                      |
|-------|--------------------------------------------------------------------|--------------------------------------------------|
| A     | Binding/authoritative primary source                               | Requirements and official constraints            |
| B     | High-quality research synthesis / peer-reviewed primary research   | Generalizable causal/descriptive claims          |
| C     | Official institutional or mature operational framework             | Applied process design                           |
| D     | High-quality practitioner/consultancy framework or documented case | Practical heuristics and implementation patterns |
| E     | Field signal / community / anecdote                                | Discovery of issues, edge cases, hypotheses      |

A Class E source can reveal an important problem. It normally cannot
establish a universal best practice on its own.

## 8.4 Evidence appraisal dimensions

For each material evidence item, assess:

**Trustworthiness** - Is the method credible? - Is the source primary? -
Are conflicts or incentives material?

**Directness** - Does it address the actual claim? - Or is it being
extrapolated from something adjacent?

**Context fit** - Same population? - Same type of organization? - Same
technology? - Same maturity level? - Same regulatory setting? - Same
objective?

**Recency** - Could the claim have changed? - Is the source still
current?

**Independence** - Are multiple sources genuinely independent? - Or are
many sources repeating one origin?

**Corroboration** - Do other credible sources converge? - Are contrary
findings present?

**Limitations** - Sample limitations? - Confounds? - Proprietary/opaque
methodology? - Vendor incentives? - Unmeasured context?

Do not reduce these dimensions to a pseudo-scientific total score unless
there is a domain-specific validated reason to do so.

## 8.5 Confidence labels

Use calibrated confidence where it improves decisions:

**HIGH**  
Multiple strong and relevant evidence streams converge, or an
authoritative requirement is unambiguous.

**MODERATE**  
Evidence is credible but incomplete, indirect, context-limited, or not
fully corroborated.

**LOW**  
Evidence is sparse, conflicting, heavily contextual, or methodologically
weak.

**INSUFFICIENT**  
A material conclusion should not yet be drawn.

Confidence MUST be about a specific claim, not about a source or entire
playbook.

## 8.6 Evidence triangulation rule

For high-impact claims, authors SHOULD attempt to triangulate across at
least two independent evidence families when practical.

Example:

> “This onboarding workflow reduces time-to-productivity.”

Potential evidence: - external research about onboarding; - internal
cohort data; - manager and new-hire observations; - stakeholder
feedback.

The number “two” is a practical house default, not a scientific law.

## 8.7 Contradictory evidence

When credible sources disagree:

1.  do not hide the disagreement;
2.  identify what exactly conflicts;
3.  compare contexts and definitions;
4.  compare evidence quality;
5.  look for boundary conditions;
6.  state what remains uncertain;
7.  make any operational default conditional;
8.  define what future observation would change the conclusion.

Avoid false balance: two sources do not receive equal weight merely
because they disagree.

## 8.8 Causal evidence appraisal

When a recommendation depends on a causal claim, the evidence review
SHOULD explicitly consider dimensions such as risk of bias,
inconsistency, indirectness/context mismatch, imprecision, and
publication/reporting bias.

These dimensions are adapted from GRADE/Cochrane. This Master Playbook
Standard does **not** claim to apply the full GRADE method outside
domains where that method is appropriate. \[S36\] \[S37\]

## 8.9 Evidence certainty is not recommendation strength

Do not infer:

> HIGH-certainty evidence → MUST do X.

A `MUST` can arise from law or a house control even when causal evidence
is limited. Conversely, strong evidence of an average effect may still
justify only a contextual recommendation if feasibility, cost,
stakeholder values, harms, or local constraints vary.

## 8.10 Conflicts, incentives, and editorial independence

For R3/R4 work, the research record SHOULD include relevant
author/reviewer conflicts, material funding/vendor interests, whether a
source is selling the method/product being evaluated, how conflicts were
managed, and whether an independent reviewer challenged the
recommendation.

A conflict does not automatically invalidate evidence. Undisclosed or
unmanaged conflicts reduce trust.

## 8.11 Fit-for-question evidence

Before appraising evidence, classify the question being answered. Common
types include:

- **requirement:** what rule or constraint applies?;
- **descriptive:** what is happening, for whom, and in what context?;
- **causal/effectiveness:** what changes what?;
- **diagnostic/explanatory:** why is the observed result occurring?;
- **predictive:** what is likely under stated conditions?;
- **experiential/qualitative:** how do users/operators experience the
  system?;
- **economic/resource:** what are the costs, benefits, and opportunity
  costs?;
- **implementation:** what affects adoption, fidelity/adaptation,
  feasibility, and sustainment?;
- **safety/risk:** what can fail, with what consequence and control?;
- **normative/decision:** what should be done given evidence, values,
  constraints, and trade-offs?

Evidence that is strong for one question type can be weak for another. A
vendor specification can establish an API requirement but not a causal
productivity claim. A randomized study can estimate an average
intervention effect but not establish a legal requirement or local
feasibility.

## 8.12 Method-specific appraisal

The generic appraisal dimensions in §8.4 are a minimum. R3/R4 research
SHOULD use a method-appropriate appraisal approach when one exists and
the decision justifies it.

Examples include risk-of-bias tools for intervention studies, structured
appraisal for qualitative evidence, economic-model review,
search-strategy peer review, or domain-specific assurance standards.

Do not invent one universal numeric evidence score. Method-specific
weaknesses should remain visible.

## 8.13 Evidence provenance and reproducibility

For R3/R4 evidence syntheses, retain enough information for another
competent reviewer to reconstruct the material evidence path:

- question/protocol version;
- sources/databases/sites searched;
- search date and material query logic;
- inclusion/exclusion decisions where systematic selection is claimed;
- extracted material findings;
- appraisal judgments;
- synthesis/recommendation record;
- reviewer changes and unresolved disagreements.

PRISMA-S emphasizes complete reporting of searches so evidence
identification can be understood and reproduced. \[S57\]

------------------------------------------------------------------------

# 9. Research standard

## 9.1 Research starts with a protocol

Before deep research, create a short research protocol.

Minimum fields:

``` yaml
research_question:
decision_or_artifact_supported:
scope:
out_of_scope:
key_subquestions:
source_families:
freshness_requirements:
critical_primary_sources:
inclusion_criteria:
exclusion_criteria:
known_conflicts_or_unknowns:
search_log_required: true|false
evidence_cutoff:
```

## 9.2 Research depth levels

### R1 — Lean research

Use for: - low-stakes; - reversible; - well-understood work.

Minimum: - authoritative sources if applicable; - one credible applied
source; - basic contradiction check.

### R2 — Standard research

Use for normal production playbooks.

Minimum: - primary/official sources; - research/institutional sources
where relevant; - applied evidence; - contradiction search; - source
register; - confidence on material claims.

### R3 — Controlled research

Use where errors are costly or scale is high.

Adds: - explicit research protocol; - systematic query coverage; -
inclusion/exclusion logic; - claim-evidence matrix; - reviewer
challenge; - explicit uncertainty log; - stronger freshness validation.

### R4 — Critical research

Use for safety, high security/privacy impact, legal/regulatory exposure,
material financial controls, or other high-consequence contexts.

Adds: - qualified domain experts; - independent review; - applicable
formal standards; - explicit risk acceptance; - test evidence; - audit
trail; - formal approval where required.

A playbook does not become safer by being longer. It becomes safer by
applying the right controls.

## 9.3 Search sequence

Recommended sequence:

1.  **Frame**
    - define the practical question;
    - define the decision the research must inform.
2.  **Map authorities**
    - regulators;
    - standards bodies;
    - official platform/vendor documentation;
    - foundational frameworks.
3.  **Map research**
    - systematic reviews;
    - meta-analyses;
    - peer-reviewed research;
    - university research centers.
4.  **Map operational practice**
    - mature operators;
    - engineering handbooks;
    - documented case studies;
    - open-source implementations.
5.  **Map applied expert practice**
    - consultancies;
    - specialist firms;
    - practitioner frameworks.
6.  **Search contradictions**
    - failures;
    - critiques;
    - null results;
    - limitations;
    - competing methods.
7.  **Search current changes**
    - recent standards;
    - platform updates;
    - regulatory changes;
    - deprecated methods.
8.  **Synthesize**
    - principles;
    - conditions;
    - decisions;
    - actions;
    - tests.

## 9.4 Freshness requirements

Every playbook MUST identify its volatility.

Suggested classes:

| Volatility | Typical examples                                                 | Default review logic       |
|------------|------------------------------------------------------------------|----------------------------|
| Stable     | basic statistics, foundational design principles                 | Scheduled + event-driven   |
| Moderate   | management practice, common architecture patterns                | 6–12 months                |
| Fast       | advertising platforms, AI models, cloud services                 | 1–3 months or event-driven |
| Real-time  | regulation change, security advisories, active incident response | continuous/event-driven    |

These are defaults. Risk can shorten the interval.

## 9.5 Research stop criteria

Research MAY stop when:

- relevant authoritative sources are covered;
- major evidence families are represented;
- recent searches add little material novelty;
- important disagreements are mapped;
- critical unknowns are visible;
- further research has low expected decision value.

Research MUST NOT stop merely because a preferred conclusion has
support.

For R4 work, expert or formal review can still be required after
apparent evidence saturation.

## 9.6 Research anti-patterns

Never call something “best practice” because:

- three blogs repeat it;
- a famous consultant says it;
- a competitor does it;
- it is common on social media;
- an AI model stated it;
- it sounds plausible;
- it has a named framework;
- it worked once internally.

## 9.7 Precommit critical decision questions where hindsight bias matters

For R3/R4 research, authors SHOULD define important outcomes, decision
criteria, and evidence questions before seeing the full result set when
practical.

This reduces the risk of selecting only outcomes that support the
preferred conclusion. NICE and Cochrane use analogous protocol-first
logic in evidence reviews. \[S35\] \[S36\]

## 9.8 Stakeholder and implementation evidence plan

The research protocol SHOULD identify which affected
users/operators/stakeholders must be consulted or represented.

For material operational guidance, research SHOULD examine likely
implementation barriers, required skills and training, resource
implications, acceptability, accessibility, local adaptation needs, and
unintended effects.

## 9.9 Source-status discipline

A draft, superseded standard, vendor announcement, or experimental
feature MUST be labeled as such.

When a newer draft exists but the previous edition remains the current
published standard, authors MUST distinguish the **current normative
baseline**, the **draft/watch item**, and any **migration implication**.

## 9.10 Select the research/review design explicitly

R2+ work SHOULD state what kind of evidence synthesis is being performed
and why it fits the decision.

Useful patterns include:

| Need                                                | Typical fit                                         |
|-----------------------------------------------------|-----------------------------------------------------|
| Broadly map concepts, source types, or gaps         | Scoping review / evidence map                       |
| Estimate effects for a focused question             | Systematic review / meta-analysis where appropriate |
| Time-constrained decision with explicit concessions | Rapid review                                        |
| Understand mechanisms in complex contexts           | Theory-based / realist-informed synthesis           |
| Combine qualitative and quantitative evidence       | Mixed-methods synthesis                             |
| Summarize existing reviews                          | Umbrella review                                     |
| Establish current platform/rule behavior            | Primary official documentation + verification       |
| Understand internal performance                     | Organizational data / experiment / audit            |
| Explore tacit operator knowledge                    | Interviews, observation, expert elicitation         |

This table is a routing aid, not a hierarchy. \[S60\]

## 9.11 Search reproducibility and peer review

For R3/R4 literature-heavy work:

- preserve material search strategies and dates;
- record major sources/platforms searched;
- record material limits and exclusions;
- document purposeful web/standards-site searches when they affect
  conclusions;
- use an information specialist or peer review of complex search
  strategies when omission risk is material;
- distinguish search completeness from evidence quality.

PRISMA-S provides a reporting framework for reproducible searches. PRESS
shows that structured peer review can identify search errors and improve
search-term selection. \[S57\] \[S59\]

## 9.12 Independent screening and extraction where error cost justifies it

For R4 evidence syntheses, critical inclusion/exclusion judgments and
extraction of decision-driving findings SHOULD receive independent
checking or a documented second-person review when feasible.

The control can be targeted to the highest-risk claims rather than
duplicated across every low-value item. Cochrane methodology
demonstrates the role of systematic selection, documentation, and
specialist search expertise in reducing review error and bias. \[S58\]

## 9.13 Research efficiency and value of information

More research is not automatically better.

Research SHOULD stop, narrow, or change method when the expected value
of additional information is lower than its cost/delay, provided the
residual uncertainty is visible and acceptable for the decision.

For high-impact uncertainty, prefer targeted research on the assumptions
most likely to change the decision rather than indiscriminate source
accumulation.

------------------------------------------------------------------------

# 10. Synthesis standard

Research is not the final deliverable. The job is to turn evidence into
usable knowledge without destroying nuance.

## 10.1 Synthesis pipeline

``` text
Raw sources
    ↓
Claims and observations
    ↓
Evidence appraisal
    ↓
Agreement / disagreement / boundary conditions
    ↓
Principles
    ↓
Decision logic
    ↓
Plays
    ↓
Runbooks / tools / templates
    ↓
Verification
    ↓
Learning
```

## 10.2 Principle extraction test

A candidate principle SHOULD pass four tests:

1.  **Durability** — likely to survive tactical changes.
2.  **Explanatory value** — helps explain why actions work.
3.  **Decision value** — changes what a competent user would choose.
4.  **Scope clarity** — states where it applies.

If it fails all four, it is probably a tip, tactic, or slogan.

## 10.3 From evidence to recommendation

A recommendation SHOULD contain:

- what to do;
- why;
- when it applies;
- important exceptions;
- evidence basis;
- confidence;
- verification method if material.

Example pattern:

> **DEF / MODERATE confidence:** For recurring operational procedures,
> have a second competent operator execute the draft before release.
> This is directly recommended in AWS operational guidance and is
> consistent with verification principles in systems engineering.
> Exceptions may be appropriate for trivial low-risk procedures. Verify
> by recording execution defects found during the dry run. \[S09\]
> \[S14\]

## 10.4 Evidence-to-Recommendation gate

For material recommendations, especially R3/R4, explicitly evaluate
dimensions that could change the action even when the evidence itself is
credible.

| Dimension              | Question                                                                                  |
|------------------------|-------------------------------------------------------------------------------------------|
| Outcome importance     | Which outcomes actually matter to the intended user/stakeholders?                         |
| Expected benefit       | What desirable effect is expected, and for whom?                                          |
| Harms / downsides      | What can worsen, be displaced, or create new risk?                                        |
| Evidence certainty     | How confident are we in the material claims?                                              |
| Context fit            | Does the evidence transfer to this population, organization, technology, and environment? |
| Stakeholder values     | Do affected users value outcomes/trade-offs differently?                                  |
| Feasibility            | Can the action realistically be executed?                                                 |
| Resources / cost       | What time, money, skills, tooling, and opportunity cost are required?                     |
| Acceptability          | Will operators/stakeholders reasonably adopt or comply?                                   |
| Accessibility / equity | Does the recommendation create avoidable access barriers or uneven effects?               |
| Alternatives           | Are there materially better or lower-risk alternatives?                                   |
| Reversibility          | Can the action be safely undone?                                                          |
| Implementation         | What barriers, training, controls, and rollout are needed?                                |

Not every low-risk recommendation requires a formal table. The rigor
MUST be proportionate.

This gate adapts the logic of GRADE Evidence-to-Decision, NICE
recommendation development, and AGREE II applicability rather than
importing a clinical framework wholesale. \[S35\] \[S37\] \[S38\]

## 10.5 Do not collapse disagreement

When two methods are both defensible, construct a decision rule rather
than picking a universal winner.

Bad:

> Method A is best.

Better:

> Use A when speed and reversibility dominate; use B when auditability
> and cross-functional coordination dominate.

## 10.6 Separate descriptive and normative content

Descriptive:

> Teams currently use X.

Normative:

> Teams SHOULD use X.

The second requires stronger justification than the first.

## 10.7 Causal / Theory-of-Change model

When a playbook is intended to change a material outcome, the synthesis
SHOULD state how the recommended actions are expected to produce that
outcome.

For R3/R4, or for complex interventions, document the critical chain:

``` text
Problem / opportunity
    ↓
Target actors / system
    ↓
Inputs + actions
    ↓
Mechanisms / intermediate changes
    ↓
Outputs
    ↓
Outcomes
    ↓
Longer-term impact
```

For each critical link, record assumptions, dependencies, contextual
factors, and the evidence or rationale supporting it. The model MAY be
non-linear and include feedback loops. \[S50\]

## 10.8 Negative theory and unintended effects

For material interventions, ask not only “why should this work?” but
also:

- why might the causal chain fail?;
- what alternative explanation could produce the same observed result?;
- what behavior might the intervention displace?;
- what perverse incentive or gaming could appear?;
- who could be harmed or excluded?;
- what second-order effect could emerge?;
- what would make the apparent success non-sustainable?

The Magenta Book 2026 explicitly recommends examining why causal steps
might not occur and using alternative explanations when evaluating
impact. \[S50\]

## 10.9 From recommendation to implementation specification

A material recommendation is incomplete if the organization cannot tell
how to adopt it safely.

Where behavior or system change is required, attach or link an
implementation specification covering:

- target adopters/operators;
- protected invariants;
- allowed local adaptations;
- prerequisites and competence;
- barriers/facilitators;
- rollout/pilot;
- support and escalation;
- adoption/implementation measures;
- outcome measures;
- stop/scale/iterate decision rules.

------------------------------------------------------------------------

# 11. Risk and rigor model

## 11.1 Rigor is determined by consequence, not prestige

Classify the artifact before construction.

Assess:

- harm if wrong;
- reversibility;
- financial materiality;
- legal/regulatory exposure;
- safety impact;
- security/privacy impact;
- number of people/systems affected;
- decision frequency;
- time pressure;
- uncertainty;
- complexity;
- dependency/blast radius;
- detectability of error;
- operator competence and cognitive load;
- degree of automation/autonomy;
- stakeholder vulnerability/accessibility;
- difficulty of monitoring after release.

## 11.2 Rigor levels

### Level 1 — LEAN

Typical: - low consequence; - highly reversible; - small scope; -
experienced user; - low ambiguity.

Required: - clear objective; - compact instructions; - basic source
check; - simple verification.

Normally **not required** at L1 unless the specific task demands it:
formal Theory of Change, traceability matrix, systematic review,
independent audit, implementation-science framework, or impact
evaluation.

### Level 2 — STANDARD

Typical: - normal repeated business activity; - moderate consequence; -
multiple users; - meaningful decisions.

Required: - full play structure; - evidence register; - acceptance
criteria; - owner; - scenario test; - version control; - implementation
and evaluation planning only where adoption or outcome attribution is
material.

### Level 3 — CONTROLLED

Typical: - material customer impact; - production systems; - significant
spend; - important strategic decisions; - sensitive data; - substantial
organizational dependency.

Adds: - explicit risk review; - stronger evidence traceability; -
independent reviewer; - error/exception paths; - rollback or contingency
where applicable; - test evidence; - approval gate; - reproducible
research record for decision-driving evidence; - competence/task
analysis for material procedures; - implementation plan where behavior
changes; - causal/evaluation plan where material outcome claims are
made; - traceability matrix for critical requirements/controls.

### Level 4 — CRITICAL

Typical: - safety; - regulated high-consequence activity; - severe
security/privacy risk; - irreversible destructive action; - major
financial/control exposure.

Adds: - qualified specialists; - external/domain standards; -
segregation of duties where relevant; - formal validation; - audit-grade
traceability; - explicit escalation; - controlled release; - stronger
change management; - independent assurance/audit; - method-appropriate
high-rigor evidence synthesis; - explicit implementation and outcome
evaluation; - retained assurance package and formal risk acceptance for
unresolved material uncertainty.

## 11.3 Escalation rule

When uncertain between two levels, choose the higher level until the
risk is understood.

The author MAY later reduce rigor with documented rationale.

## 11.4 Proportionality safeguard

V2 adds more possible controls, not more mandatory bureaucracy.

A control SHOULD be included only when at least one of the following is
true:

- it reduces a material decision/execution risk;
- it is required by an applicable authority or governance model;
- it materially improves evidence quality or auditability;
- it enables adoption, accessibility, or safe adaptation;
- it creates learning that can change a meaningful decision.

If a control does none of these, remove it, simplify it, or move it to
optional reference material.

The burden of documentation itself is a cost and can create risk by
obscuring critical information.

------------------------------------------------------------------------

# 12. Information architecture

A domain playbook SHOULD usually support four reading modes.

## Layer 1 — Orientation

Answers:

- What is this?
- What outcome does it enable?
- What is in/out of scope?
- What principles matter?
- How is the domain structured?
- Where do I start?

Typical artifacts: - executive overview; - map; - glossary; - “how to
use this playbook.”

## Layer 2 — Decision

Answers:

- Which path applies?
- What factors matter?
- What are the trade-offs?
- When should I escalate?
- What evidence is sufficient?

Typical artifacts: - decision trees; - decision tables; - heuristics; -
thresholds; - criteria; - escalation rules.

## Layer 3 — Execution

Answers:

- What do I do?
- In what order?
- With what inputs/tools?
- What should the output look like?
- How do I know it is done?

Typical artifacts: - plays; - runbooks; - checklists; - templates; -
examples.

## Layer 4 — Assurance and learning

Answers:

- Why should I trust this?
- What sources support it?
- What changed?
- How is it tested?
- What have we learned?

Typical artifacts: - source register; - claim-evidence matrix; - test
log; - change log; - known limitations; - review history.

## Cross-cutting implementation view

Where adoption is material, users SHOULD also be able to answer:

- What must change in current behavior/process?
- Who needs training or support?
- What can be adapted locally and what is invariant?
- What resources/permissions are required?
- How will rollout, feedback, and retirement of old guidance work?

This view can be embedded across the four layers rather than added as a
fifth layer.

------------------------------------------------------------------------

# 13. Canonical domain playbook structure

This is a **default architecture**, not a mandatory chapter list.

``` text
00. Front Matter
01. Purpose, Scope & Outcomes
02. How to Use This Playbook
03. Core Principles
04. Domain / System Model
05. Strategy & Decision Framework
06. End-to-End Operating Model
07. Implementation / Adoption Plan (when material)
08+. Plays
XX. Measurement & Feedback
XX. Governance / Roles
XX. Templates, Tools & Checklists
XX. Evidence & Sources
XX. Glossary
XX. Change Log
```

A small execution playbook might use only five sections. A critical
operating playbook may require substantially more.

ISO 10013 explicitly supports tailoring documented information to
organizational needs and no longer prescribes one fixed documentation
hierarchy. \[S02\]

------------------------------------------------------------------------

# 14. The atomic Play Standard

## 14.1 Required core

Every production Play MUST make the following recoverable, even if some
fields are combined for readability:

1.  **Play ID and title**
2.  **Objective / intended outcome**
3.  **Trigger / when to use**
4.  **Relevant context or preconditions**
5.  **Inputs**
6.  **Method or decision logic**
7.  **Output / resulting state**
8.  **Acceptance criteria**
9.  **Evidence/status information appropriate to risk**

## 14.2 Conditional fields

Add when useful or risk requires:

- when not to use;
- owner;
- roles;
- required competence/training;
- decision rights;
- dependencies;
- tools;
- permissions;
- estimated effort/time;
- decision points;
- thresholds;
- guardrails;
- failure modes;
- error handling;
- escalation;
- recovery;
- rollback;
- communication plan;
- metrics;
- examples;
- anti-examples;
- related plays;
- evidence citations;
- uncertainty/confidence;
- automation notes;
- implementation/adoption notes;
- side-effect/reversibility class;
- observability/monitoring;
- conflict-of-interest or independence note where material.

## 14.3 Canonical Play template

``` markdown
# PLAY-[ID] — [Action-oriented title]

## Objective
[Observable outcome.]

## Use when
- ...

## Do not use when
- ...

## Preconditions
- ...

## Inputs
- ...

## Roles / decision rights
- Owner:
- Decision owner:
- Contributors:
- Escalation:

## Method
[Principles, reasoning, or diagnostic approach.]

## Decision logic
| Condition | Action | Rationale |
|---|---|---|
| ... | ... | ... |

## Execution
1. ...
2. ...
3. ...

## Guardrails
- MUST ...
- MUST NOT ...
- SHOULD ...

## Output
- ...

## Acceptance criteria
- [ ] ...

## Metrics / signals
- ...

## Failure modes and recovery
| Failure mode | Detection | Response | Escalation |
|---|---|---|---|
| ... | ... | ... | ... |

## Evidence
- Claim:
- Classification:
- Confidence:
- Sources:

## Related artifacts
- ...
```

Do not render unused headings merely to satisfy the template.

------------------------------------------------------------------------

# 15. Decision architecture standard

A Decision Play SHOULD make decision quality inspectable.

## 15.1 Decision record

Minimum:

``` yaml
decision:
owner:
date:
desired_outcome:
constraints:
alternatives:
criteria:
evidence:
assumptions:
uncertainties:
tradeoffs:
decision:
rationale:
revisit_trigger:
```

## 15.2 Decision design sequence

1.  **Define the decision**
    - What actual choice is being made?
    - Who owns it?
    - By when?
2.  **Define the outcome**
    - What are we optimizing for?
    - What would make the decision successful?
3.  **Set constraints**
    - legal;
    - safety;
    - budget;
    - timing;
    - strategy;
    - technical.
4.  **Generate real alternatives**
    - avoid false binary choices;
    - include “do nothing” when legitimate.
5.  **Define criteria**
    - observable where possible;
    - distinguish mandatory criteria from preference criteria.
6.  **Gather evidence**
    - only evidence that can materially inform the criteria.
7.  **Expose uncertainty**
    - assumptions;
    - ranges;
    - missing information;
    - sensitivity.
8.  **Evaluate trade-offs**
    - do not hide them in a single opaque score.
9.  **Run the Evidence-to-Recommendation gate where material**
    - benefits/harms;
    - feasibility/resources;
    - stakeholder values/acceptability;
    - accessibility/equity;
    - alternatives/reversibility;
    - implementation barriers.
10. **Assign decision rights**

- one accountable decision owner for material decisions unless
  governance requires otherwise.

11. **Record rationale**
    - enough to understand later why the decision was reasonable at the
      time.
12. **Define revisit triggers**
    - new evidence;
    - failed assumption;
    - KPI threshold;
    - date;
    - incident.

NASA’s decision-analysis guidance strongly supports explicitly defining
outcomes, criteria, alternatives, evaluation methods, assumptions,
limitations, and uncertainty, with rigor proportional to consequence and
complexity. \[S14\]

Bain’s RAPID framework is a useful optional pattern for complex
cross-functional decisions, distinguishing Recommend, Agree, Perform,
Input, and Decide roles. It is an applied framework, not a mandatory
universal taxonomy. \[S25\]

Wharton sources similarly emphasize clear decision boundaries and
decision framing before analytics. \[S30\] \[S31\]

------------------------------------------------------------------------

# 16. Runbook and SOP standard

## 16.1 Use a runbook when the path is known

A runbook SHOULD NOT carry unnecessary strategy explanation.

It MUST optimize for correct execution.

Minimum:

``` markdown
# RUN-[ID] — [Outcome]

## Purpose
## Trigger
## Preconditions
## Required tools / permissions
## Safety / constraints
## Steps
1. ...
2. ...
3. ...

## Expected result
## Verification
## Error handling
## Exceptions
## Escalation
## Rollback / recovery
## Owner
## Version / last tested
```

## 16.2 Runbook quality rules

- Steps SHOULD begin with an action verb.
- One step SHOULD represent one meaningful action.
- Preconditions MUST be separated from actions.
- Expected states SHOULD be observable.
- Dangerous or irreversible actions MUST be conspicuous.
- Required permissions MUST be explicit.
- Branches SHOULD be represented clearly.
- Error paths MUST be included when failure is plausible and material.
- Screenshots SHOULD NOT replace durable text when interfaces change
  frequently.
- Commands/code MUST be tested in the relevant environment before
  release where material.
- A second user SHOULD dry-run material runbooks.
- Frequently repeated stable runbooks SHOULD be candidates for
  automation.

These points align closely with AWS operational guidance. \[S09\]

------------------------------------------------------------------------

# 17. Checklist standard

Checklists are for memory support and verification, not education.

A good checklist item is:

- brief;
- observable;
- unambiguous;
- action-oriented;
- ordered only when order matters;
- grouped by phase where useful.

Bad:

- “Ensure strategy is strong.”
- “Optimize the campaign.”
- “Think about risk.”

Better:

- “Decision owner is named.”
- “Conversion event has been verified in the target environment.”
- “Rollback path was tested or explicitly waived by the approver.”

Checklist items requiring interpretation SHOULD link to the relevant
Play.

Additional checklist rules:

- Each item SHOULD contain one primary action or verification.
- Critical items SHOULD be prioritized over comprehensiveness.
- A checklist SHOULD remain short enough to be reliably used in its
  operating context.
- The responsible person/role SHOULD be clear when ambiguity would
  create risk.
- Teams MAY adapt layout/order to local workflow, but protected
  safety/control items MUST NOT be silently removed.
- Material checklist changes SHOULD be piloted with representative users
  before broad rollout.

NICE recommends one main action per recommendation; WHO warns against
making checklists unmanageably comprehensive and encourages local
adaptation while protecting critical safety steps; Microsoft recommends
simple, discrete, actionable checklist items. \[S35\] \[S34\] \[S11\]

------------------------------------------------------------------------

# 18. Template standard

A template SHOULD make a good output easier than a bad output.

It SHOULD:

- reflect the actual downstream decision or use;
- distinguish mandatory from optional fields;
- include short prompts rather than essays;
- incorporate acceptance criteria;
- include source/evidence fields for material claims;
- avoid duplicate capture;
- allow `N/A` with rationale where relevant;
- evolve with observed user errors.

Templates SHOULD NOT become a proxy for thinking.

------------------------------------------------------------------------

# 19. Writing standard

## 19.1 Write for use, not literary completeness

Prefer:

- concrete nouns;
- action verbs;
- explicit conditions;
- visible outputs;
- defined terms;
- examples where ambiguity remains.

Avoid:

- motivational filler;
- buzzwords;
- unsupported superlatives;
- vague verbs such as “optimize,” “leverage,” or “improve” without an
  object and criterion;
- paragraphs that combine unrelated rules;
- unexplained acronyms;
- duplicated truth across multiple pages.

## 19.2 One concept, one canonical home

A rule SHOULD have one canonical source in the playbook.

Other locations SHOULD link to it rather than copy it.

This reduces drift.

## 19.3 Operational definitions

Important ambiguous terms MUST be defined operationally.

Instead of:

> Large customer.

Use:

> Customer with \>€50k ARR for the purposes of this play.

Definitions can be local to a Play if the domain meaning varies.

## 19.4 Explain why at the right depth

A runbook step may need one sentence of rationale.

A principle may need a deeper explanation.

Do not bury execution under theory.

## 19.5 Examples

Examples SHOULD be used when they reduce interpretation risk.

Examples MUST be labeled as examples, not requirements.

Include counterexamples when users predictably make the same mistake.

## 19.6 Accessibility and cognitive ergonomics

Production playbooks SHOULD use clear, literal, concise language
appropriate to the audience.

For important instructions:

- separate distinct steps;
- use descriptive headings;
- explain uncommon acronyms/jargon;
- avoid relying on color or visual formatting alone to carry meaning;
- make structure navigable by assistive technologies in the delivery
  format;
- provide examples where they materially reduce interpretation error;
- make error states and recovery instructions explicit.

W3C WAI guidance treats clear words, short structured content,
descriptive headings, and stepwise instructions as accessibility
mechanisms that also improve general usability. \[S40\]

## 19.7 Implementation-ready content

Where a playbook changes existing behavior, it SHOULD state:

- target users and baseline competence;
- what changes from current practice;
- training/coaching needed;
- local adaptation allowed vs prohibited;
- rollout/pilot approach;
- support/escalation path;
- adoption and outcome signals;
- retirement/supersession of old guidance.

WHO’s checklist implementation manual emphasizes staff engagement,
leadership/champions, education/training, multidisciplinary involvement,
coaching, ongoing feedback, and local adaptation. \[S34\]

## 19.8 Competence and task-analysis standard

For material execution content, the author SHOULD understand the real
task before prescribing it.

For R3/R4 procedures, or where human error has meaningful consequence,
use proportionate task analysis with representative operators. Examine:

- actual starting state and environment;
- information needed at each step;
- decisions and handoffs;
- tools/interfaces and permissions;
- interruptions, workload, and time pressure;
- common workarounds and deviations;
- error-likely steps;
- recovery opportunities;
- required knowledge and skill;
- nominal, degraded, contingency, and emergency states where relevant.

HSE recommends task analysis and user involvement when developing
procedures and warns that procedures should not be the sole defence
against human error. NASA human-systems guidance similarly uses task
analysis, prototyping, early user involvement, and human-in-the-loop
testing. \[S54\] \[S55\]

## 19.9 Protected invariants and adaptable periphery

Where local adaptation is expected, distinguish:

**Protected invariants** — controls, outcomes, safety/security
boundaries, definitions, evidence requirements, or decision rights that
MUST remain intact.

**Adaptable periphery** — wording, sequence, tooling, examples, local
roles, or delivery mechanisms that MAY change when the protected
outcome/control is preserved.

This prevents two opposite failures: rigid standardization that does not
fit local context, and uncontrolled adaptation that silently removes the
mechanism that made the practice effective.

------------------------------------------------------------------------

# 20. Human + AI execution compatibility

This section is a `HOUSE` standard informed by structured-document,
operational, and software-engineering principles. It is not presented as
an external universal standard.

A modern playbook MAY be used by humans, AI assistants, agents,
automations, or mixed teams. To support this safely:

## 20.1 Stable identity

Every important artifact SHOULD have:

- stable ID;
- title;
- version;
- status;
- owner;
- last review date.

## 20.2 Explicit context

Avoid hidden references such as:

> Do it like last time.

Prefer:

> Use `PLAY-MKT-004`, version 2.1, with the customer interview dataset
> stored at \[canonical location\].

## 20.3 Explicit inputs and outputs

Inputs SHOULD include: - required data; - format; - source; -
freshness; - permission/classification.

Outputs SHOULD include: - structure; - location; - acceptance
criteria; - consumer.

## 20.4 Tool and permission boundaries

For agent-executable plays, specify:

- permitted tools;
- prohibited actions;
- read/write scope;
- approval boundaries;
- destructive action controls;
- credential handling;
- escalation.

## 20.5 State transitions

For long-running workflows, define meaningful states such as:

``` text
DRAFT → READY_FOR_REVIEW → APPROVED → EXECUTING → VERIFIED → CLOSED
```

## 20.6 Source provenance

AI-generated synthesis MUST NOT erase source provenance for material
claims.

## 20.7 Human review boundaries

Human review SHOULD be mandatory when:

- consequence is high;
- the action is irreversible;
- the agent lacks necessary context;
- legal/safety/security interpretation is material;
- a confidence threshold is not met;
- policy explicitly requires approval.

## 20.8 Agent-friendly decision tables

When possible, express deterministic branches in structured tables
rather than prose.

Do not make inherently judgment-heavy decisions falsely deterministic
just to make them machine-readable.

## 20.9 Side effects, reversibility, and approvals

Agent-executable actions SHOULD be classified at least as:

- read-only / observational;
- reversible write;
- externally consequential but recoverable;
- irreversible or high-impact.

Approval and verification requirements SHOULD increase with side-effect
class.

## 20.10 Preconditions, postconditions, and schema validation

For automated execution, define:

- machine-checkable preconditions where practical;
- expected postconditions;
- structured output schemas;
- validation failures;
- safe fallback behavior.

A model output is not authorization.

## 20.11 Retries, idempotency, concurrency, and bounded execution

Where tools can mutate state, specify as relevant:

- whether an operation is safe to retry;
- idempotency key/strategy;
- concurrency/locking assumptions;
- timeout;
- retry limit/backoff;
- recursion/tool-chain/cost limits;
- duplicate-action prevention.

These controls are context-dependent engineering requirements, not
mandatory fields for every human-only Play.

## 20.12 Untrusted inputs and provenance

External content such as web pages, email, documents, tool responses,
retrieved memory, or inter-agent messages SHOULD be treated according to
its trust boundary.

Material machine actions SHOULD preserve enough provenance to
reconstruct:

- triggering request;
- source inputs;
- policy/playbook version;
- approvals;
- tool calls/side effects;
- resulting state.

## 20.13 Observability and post-deployment monitoring

For material autonomous or probabilistic workflows, define:

- success/failure signals;
- anomaly conditions;
- audit/logging requirements;
- monitoring owner;
- incident/escalation path;
- stop/kill mechanism;
- post-deployment review triggers.

NIST’s 2026 work on deployed AI emphasizes that pre-deployment
evaluation alone cannot reveal all behavior under dynamic real-world
conditions; post-deployment monitoring is needed to validate reliability
and detect unforeseen outcomes. \[S42\]

## 20.14 Adversarial and misuse testing

Higher-risk AI/agent Plays SHOULD test:

- malformed/conflicting inputs;
- prompt or instruction injection where relevant;
- permission escalation attempts;
- unexpected tool responses;
- unsafe chaining;
- cost/loop exhaustion;
- stale or poisoned context;
- high-impact action without valid approval.

NIST AI 600-1 recommends adversarial exercises/red-teaming/chaos testing
for unforeseen failure modes; OWASP provides applied controls for
excessive agency and tool misuse. \[S41\] \[S43\]

## 20.15 Multi-method AI evaluation

For material AI-enabled Plays, one evaluation mode is rarely sufficient.

Where risk justifies it, the evaluation plan SHOULD combine
complementary methods such as:

- component/model testing;
- scenario/task testing;
- adversarial/red-team testing;
- user/human-in-the-loop testing;
- integration/system testing;
- production monitoring and incident review.

NIST’s September 2026 ARIA Evaluation Planning Manual explicitly
combines model testing, red teaming, and user testing as complementary
evidence for holistic AI evaluation. \[S62\]

## 20.16 Emerging AI-evaluation methods remain provisional

NIST’s TEVV-Athlon framework is an initial public draft as of this
evidence cutoff. It is useful as an emerging model for context-specific
AI evaluation, including agentic systems, but MUST NOT be represented as
a final normative standard until its status changes. \[S63\]

------------------------------------------------------------------------

# 21. Implementation and adoption standard

A playbook that changes behavior, roles, systems, or decisions has an
implementation problem as well as a content problem.

This section is required when failure to adopt or sustain the playbook
could materially prevent the intended outcome.

## 21.1 Diagnose implementation context

Use a proportionate context scan before rollout.

At minimum consider:

- **the innovation/playbook itself:** complexity, advantage,
  compatibility, evidence credibility, adaptability;
- **outer context:** regulation, customers, partners, market/system
  pressures, dependencies;
- **inner context:** structure, workflow, resources, leadership,
  culture, incentives, competing priorities;
- **people:** knowledge, skill, role clarity, confidence, motivation,
  workload, affected stakeholder needs;
- **implementation process:** ownership, champions, planning,
  engagement, feedback, adaptation, learning.

This is a cross-domain adaptation of the updated CFIR’s logic. The full
CFIR construct set is optional and SHOULD be used only when the
implementation question warrants it. \[S51\]

## 21.2 Define implementation outcomes separately

Where implementation is material, select the implementation outcomes
that matter rather than using “rolled out” as the success criterion.

Potential outcomes include:

- **acceptability** — do intended users consider it usable/acceptable?;
- **appropriateness** — does it fit the task and setting?;
- **feasibility** — can it actually be performed with available
  constraints?;
- **adoption** — are intended users/settings taking it up?;
- **reach / penetration** — is it reaching the relevant
  population/workflows?;
- **fidelity** — are protected mechanisms/controls preserved?;
- **adaptation quality** — are local changes intentional and safe?;
- **implementation cost** — what resources does adoption consume?;
- **sustainability / maintenance** — does effective use persist over
  time?

The Proctor taxonomy and RE-AIM/PRISM distinguish implementation
outcomes from service and end-user outcomes; V2 adopts that distinction
without assuming healthcare-specific measures. \[S52\] \[S53\]

## 21.3 Fidelity is not blind compliance

The goal is not perfect textual conformity.

For adaptable playbooks, measure whether **protected invariants** are
preserved and whether local adaptations improve fit without removing
critical mechanisms or controls.

Record material adaptations:

``` yaml
adaptation_id:
context:
original_element:
change:
reason:
protected_invariants_checked:
expected_effect:
risk:
approved_by:
outcome_observed:
retain_revert_or_scale:
```

## 21.4 Implementation plan

For R2+ behavior-changing playbooks, the release package SHOULD answer:

- Who must adopt what?
- What current behavior/process is being replaced?
- What knowledge/skill gap exists?
- What barriers and facilitators are known?
- What resources, tools, permissions, and time are required?
- What training/rehearsal/support is required?
- What local adaptation is allowed?
- What rollout sequence or pilot is appropriate?
- What old guidance/process must be retired?
- How will adoption and implementation quality be observed?
- What signals trigger pause, redesign, scale, or rollback?

## 21.5 Quality culture and incentives

Where the playbook depends on sustained discretionary behavior, authors
SHOULD consider whether incentives, leadership behavior, psychological
safety, performance measures, or local norms contradict the written
standard.

A playbook cannot compensate indefinitely for a system that rewards the
opposite behavior. ISO 9001:2026 places stronger emphasis on leadership,
accountability, and quality culture; ISO 10010 provides complementary
guidance on organizational quality culture. \[S01\] \[S64\]

## 21.6 Implementation learning

Implementation data SHOULD be used to distinguish:

- content defect;
- training/competence defect;
- workflow/tooling defect;
- incentive/culture defect;
- context mismatch;
- resource constraint;
- adoption problem;
- true failure of the underlying recommendation.

Do not “fix the documentation” when the actual failure is elsewhere in
the system.

------------------------------------------------------------------------

# 22. Outcome and evaluation architecture

Verification proves that the artifact satisfies specified requirements.
Validation shows that it is fit for intended users and conditions.
Evaluation asks what happened in use, for whom, why, at what cost, and
whether the observed change can reasonably be attributed to the
intervention.

## 22.1 Define the evaluation question before the metric

For material playbooks, select questions across the dimensions that
matter:

**Process** - Was the playbook delivered/used as intended? - Where did
execution diverge and why?

**Implementation** - Was it acceptable, appropriate, feasible, adopted,
and sustained? - Which contextual factors helped or blocked use?

**Outcome / impact** - Did the intended result change? - For whom and
under what conditions? - What unintended effects occurred?

**Value** - Was the improvement worth the time, cost, risk, and
opportunity cost?

The 2026 Magenta Book separates process, impact, and value-for-money
evaluation and recommends proportionate evaluation designed early enough
to inform implementation. \[S50\]

## 22.2 Build a Theory of Change when causal learning matters

For R3/R4 interventions, or where causal claims drive material
decisions, define and maintain a Theory of Change or equivalent causal
model.

Minimum fields:

``` yaml
problem:
target_population_or_system:
inputs:
activities:
mechanisms:
outputs:
intermediate_outcomes:
end_outcomes:
critical_assumptions:
context_dependencies:
alternative_explanations:
unintended_outcomes:
evidence_for_critical_links:
```

The model SHOULD evolve when evidence invalidates an assumption. \[S50\]

## 22.3 Baselines, comparators, and counterfactuals

A before/after change is not automatically caused by the playbook.

Where causal attribution matters, the evaluation SHOULD use the
strongest feasible design for the decision, such as:

- randomized experiment;
- controlled/quasi-experimental comparison;
- interrupted time series;
- phased rollout;
- matched comparison;
- credible theory-based contribution analysis;
- repeated measures with alternative explanations explicitly tested.

The required design depends on risk, feasibility, ethics, decision
value, and available data. Do not claim causality from a design that
supports only association.

## 22.4 Measurement stack

Use measures at multiple levels where relevant:

1.  **readiness/input** — prerequisites, competence, availability;
2.  **implementation** — reach, adoption, feasibility,
    fidelity/adaptation;
3.  **process/execution** — completion, errors, rework, cycle time,
    exceptions;
4.  **outcome** — intended user/business/system result;
5.  **guardrail** — harms, safety, security, accessibility, cost,
    displacement;
6.  **sustainment** — persistence of benefit and continued use;
7.  **learning** — speed and quality of corrective improvement.

Avoid treating a leading indicator as proof of end outcome.

## 22.5 Decision-linked evaluation

Before rollout, define which evidence would trigger:

- continue;
- iterate;
- scale;
- narrow scope;
- pause;
- rollback;
- retire;
- commission stronger evaluation.

Predefined decision use reduces the risk of collecting metrics that
never change a decision.

## 22.6 Proportionality and evaluability

Not every playbook requires an impact study.

Evaluation depth SHOULD increase with:

- consequence and scale;
- uncertainty about effectiveness;
- cost/irreversibility;
- novelty;
- heterogeneity of users/contexts;
- strength of causal claims;
- strategic importance;
- availability of credible measurement.

For low-risk, well-established procedures, monitoring and periodic
validation may be sufficient. For novel high-impact interventions,
stronger evaluation can be a condition of scaling. \[S50\]

------------------------------------------------------------------------

# 23. Traceability and assurance spine

V2 introduces a formal traceability spine for higher-rigor playbooks.

## 23.1 Traceability objects

Material items SHOULD have stable IDs where practical:

- external requirement;
- claim;
- evidence item;
- recommendation;
- decision;
- Play/control;
- test;
- defect;
- outcome measure;
- exception;
- change.

## 23.2 R3/R4 traceability matrix

A compact matrix MAY be used:

| ID  | Requirement / claim | Evidence | Recommendation / control | Artifact | Verification / validation | Outcome signal | Status |
|-----|---------------------|----------|--------------------------|----------|---------------------------|----------------|--------|

For R4 work, material requirements and controls SHOULD have no
unexplained orphan state:

- requirement with no implementation;
- recommendation with no evidence/rationale;
- critical control with no test;
- test with no current requirement/control;
- outcome with no decision use.

NASA’s requirements verification and validation matrices are the
principal systems-engineering inspiration for this control. \[S14\]

## 23.3 Bidirectional change impact

When a material source, requirement, recommendation, Play, tool, or test
changes, the owner SHOULD be able to identify affected downstream and
upstream artifacts.

Examples:

- regulation changes → which Plays and tests are affected?;
- tool/API changes → which procedures and screenshots are stale?;
- failed test → which recommendation/control is implicated?;
- new evidence → which decision logic should be reconsidered?;
- changed recommendation → which training and agent policies must
  migrate?

## 23.4 Tool quality is part of playbook quality

If a software tool, automation, or interface is required to execute a
playbook, its relevant quality characteristics become dependencies of
the operating capability.

For software-intensive playbooks, teams MAY use ISO/IEC 25010:2023 as a
reference model when defining product-quality requirements and
acceptance criteria. \[S61\]

## 23.5 Assurance evidence package

R3/R4 releases SHOULD retain an assurance package sufficient for later
review:

- approved scope and rigor level;
- research protocol/search record;
- claim-evidence matrix;
- recommendation records;
- traceability matrix where required;
- test/validation evidence;
- unresolved risks/exceptions;
- approvals;
- release version;
- monitoring/evaluation plan.

The package can be distributed across version-controlled systems; it
does not need to be one large document.

------------------------------------------------------------------------

# 24. Audit and independent review standard

The purpose of audit is not to prove that the playbook has headings. It
is to obtain credible evidence about whether the governed system
conforms to relevant requirements and is effective enough for its
intended purpose.

## 24.1 Audit types

Use the lightest type that can answer the assurance question:

- **self-check** — author/team checks completeness and obvious defects;
- **peer review** — competent colleague challenges
  logic/evidence/usability;
- **independent internal audit** — reviewer independent of
  authorship/operation;
- **external/domain review** — qualified outside specialist or
  stakeholder;
- **field audit** — samples actual execution, records, outcomes, and
  exceptions.

## 24.2 Audit principles

For R3/R4 audits, apply proportionate principles consistent with ISO
19011:2026:

- integrity;
- fair presentation;
- due professional care;
- confidentiality;
- independence/impartiality where required;
- evidence-based conclusions;
- risk-based focus;
- competent auditors/reviewers.

\[S49\]

## 24.3 Audit planning

Define before the audit:

``` yaml
audit_objective:
scope:
criteria:
risk_focus:
auditor_or_reviewers:
independence:
competence_required:
evidence_to_sample:
users_or_executions_to_observe:
methods:
reporting:
finding_severity:
follow_up_required:
```

## 24.4 Sample real operation

For material operational playbooks, audit evidence SHOULD include a
sample of actual execution or realistic simulation where feasible.

Possible evidence:

- operator observation;
- completed records;
- tool logs;
- approvals;
- exception handling;
- output quality;
- incident/defect data;
- outcome/guardrail metrics;
- user feedback;
- change history.

Document conformance without field evidence is weak assurance for an
operational capability.

## 24.5 External review and stakeholder challenge

For R4 guidance, or guidance affecting many stakeholders with material
consequence, an appropriately independent external/domain review SHOULD
be considered.

Where stakeholder values, feasibility, or burden can materially change
the recommendation, representative stakeholder comment SHOULD be
included before final release or scaling.

The National Academies’ trustworthy-guideline standards emphasize
transparency, conflict management, multidisciplinary development,
external review, response to review comments, and updating. \[S56\]

## 24.6 Findings and closure

Audit findings SHOULD identify:

- criterion;
- evidence;
- finding;
- severity;
- owner;
- corrective action or risk acceptance;
- due date;
- verification of closure.

Repeated findings SHOULD trigger system/root-cause analysis rather than
repeated copy edits.

## 24.7 Audit the standard itself

The Master Playbook Standard is subject to the same logic it imposes on
domain playbooks.

At each major release, audit at least:

- source currency;
- unresolved contradictions;
- field usability;
- cross-domain fit;
- over-standardization;
- missing failure modes;
- implementation burden;
- whether required controls actually improve outcomes;
- whether any HOUSE rule is being misrepresented as universal best
  practice.

------------------------------------------------------------------------

# 25. Verification and validation

## 25.1 Verification

**Question:** Did we build the playbook correctly?

Examples:

- all required sections present;
- citations resolve;
- decision table has no impossible branch;
- commands run;
- template fields match outputs;
- links work;
- acceptance criteria are testable;
- no contradictory MUST statements.

## 25.2 Validation

**Question:** Did we build the right playbook for actual users and
operating conditions?

Examples:

- target user can find the right Play;
- user can complete the task without author intervention;
- decision logic handles realistic cases;
- output is useful to downstream stakeholders;
- time burden is reasonable;
- edge cases do not create unacceptable risk.

NASA’s distinction between verification (“built right”) and validation
(“right thing built”) is adopted here as a useful general design
principle. \[S14\]

------------------------------------------------------------------------

# 26. Quality gates

A playbook progresses through gates rather than being declared “done”
after writing.

## Gate 0 — Scope gate

Pass if:

- purpose is explicit;
- primary user is known;
- outcome is defined;
- scope/out-of-scope are defined;
- archetype is selected;
- risk/rigor level is selected;
- the team has decided whether a causal/Theory-of-Change model,
  implementation plan, and formal evaluation are required.

Blockers:

- unclear outcome;
- multiple incompatible audiences without segmentation;
- no decision about required rigor.

## Gate 1 — Evidence gate

Pass if:

- critical authoritative sources are covered;
- source register exists;
- material conflicts/incentives are disclosed for R3/R4;
- stakeholder/implementation evidence is included where it can change
  the recommendation;
- material claims are classified;
- contradictory evidence has been sought;
- evidence cutoff is known;
- important uncertainty is visible;
- R2+ research design is explicit;
- R3/R4 search/evidence provenance is reproducible enough for review;
- method-specific appraisal or peer review is used where the evidence
  type and consequence justify it.

Blockers:

- material `REQ` has no authority;
- “best practice” claim rests only on weak repetition;
- current platform/regulatory facts are unverified.

## Gate 2 — Architecture gate

Pass if:

- information layers are clear;
- principles and tactics are separated;
- plays map to real outcomes/decisions;
- runbooks are used only for known paths;
- navigation is coherent;
- duplication is controlled.

## Gate 3 — Construction verification gate

Pass if:

- every Play has required core information;
- decision branches are internally consistent;
- outputs and acceptance criteria align;
- tools/templates work;
- material procedures were technically checked;
- required competence and task-analysis assumptions are explicit;
- R3/R4 material requirements/recommendations/controls are traceable to
  tests;
- no unresolved blocker defects remain.

## Gate 4 — User/scenario validation gate

Pass if:

- representative scenarios were tested;
- representative intended users/stakeholders were included where
  material;
- at least one competent non-author user has executed/challenged
  material operational content where appropriate;
- critical edge cases were tested;
- major usability defects are resolved;
- implementation barriers/facilitators were tested where adoption is
  material;
- protected invariants survive permitted local adaptation.

AWS directly recommends second-person validation for operational
runbooks and playbooks. \[S09\] \[S10\]

## Gate 5 — Release gate

Pass if:

- owner is named;
- status/version are set;
- implementation/adoption plan exists where behavior change is required;
- review cadence/triggers are defined;
- change log exists;
- evidence cutoff is visible;
- distribution/canonical location is known;
- implementation outcomes and end outcomes are distinguished where
  relevant;
- evaluation/monitoring decision rules exist where material;
- R3/R4 assurance evidence is retained.

## Gate 6 — Learning gate

Ongoing.

Monitor: - usage; - adoption/implementation quality; -
success/failure; - exceptions; - user confusion; - escalation; - outcome
and guardrail metrics; - unintended effects; - new evidence; - external
changes; - whether observed results support or invalidate the causal
assumptions.

------------------------------------------------------------------------

# 27. QA audit system

Each production playbook SHOULD be audited across the following
dimensions.

## 27.1 Scope audit

Questions: - Does the playbook solve the stated problem? - Is anything
material outside its intended scope accidentally treated as covered? -
Are users and contexts explicit?

## 27.2 Authority audit

Questions: - Did we identify the source with actual authority over
requirements? - Are platform/vendor constraints sourced from official
documentation? - Are legal/regulatory claims verified in the correct
jurisdiction?

## 27.3 Evidence audit

Questions: - Are material claims traceable? - Is source quality
appropriate? - Is evidence relevant to the population/context? - Are
confidence and limitations honest?

## 27.4 Contradiction audit

Questions: - What credible evidence disagrees? - Are competing methods
described? - Are boundary conditions visible? - Did confirmation bias
shape source selection?

## 27.5 Completeness audit

Questions: - Is an essential decision missing? - Is a lifecycle phase
missing? - Are failure, recovery, or measurement absent where needed?

Completeness means complete enough for the outcome, not encyclopedic.

## 27.6 Internal consistency audit

Questions: - Do two Plays prescribe conflicting action under the same
condition? - Are terms used consistently? - Do metrics match stated
outcomes? - Do templates match the process?

## 27.7 Execution audit

Questions: - Can a competent user act without guessing hidden
assumptions? - Are inputs available? - Are permissions/tools explicit? -
Are outputs observable?

## 27.8 Naive-user audit

Give the artifact to a competent user who did not write it.

Observe: - where they hesitate; - what they misunderstand; - what they
skip; - what they ask; - where they improvise.

Do not coach unless safety requires it. The questions reveal missing
documentation.

## 27.9 Scenario audit

Test at least: - normal case; - constrained case; - failure case; - edge
case relevant to risk.

## 27.10 Safety/control audit

For controlled/critical work: - destructive actions; - sensitive data; -
authentication/authorization; - financial approval; - legal
constraints; - rollback; - escalation; - segregation of duties.

## 27.11 Simplicity audit

Ask:

> If this section disappeared, would correct decisions or execution
> materially worsen?

If no, remove or move it to reference material.

## 27.12 Freshness audit

Check: - changed standards; - changed regulation; - changed
software/platform UI; - deprecated APIs; - new evidence; - changed
internal operating model.

## 27.13 Applicability / implementation audit

Questions: - Are barriers and facilitators understood? - Are required
skills, time, money, tools, and permissions realistic? - Is local
adaptation defined? - Is training/support sufficient? - Is the old
process retired or likely to conflict?

## 27.14 Stakeholder / accessibility audit

Questions: - Were intended users and materially affected stakeholders
represented? - Can target users find and understand the guidance? - Are
avoidable disability/language/cognitive barriers present? - Does the
recommendation create uneven access or burden that changes the decision?

## 27.15 Independence / conflict audit

Questions: - Are material author/reviewer/source incentives visible? -
Did a vendor/funder influence recommendation formulation? - Was an
independent challenge performed for R3/R4? - Are conflicts managed
rather than merely disclosed?

## 27.16 Automation / agent-control audit

When machine execution applies: - least privilege; - input trust
boundaries; - approval gates; - reversibility; -
idempotency/retry/concurrency; - schema validation; - bounded
execution; - provenance/logging; - monitoring; - stop/recovery; -
adversarial tests.

## 27.17 Causal / evaluation audit

Questions: - Is the path from action to outcome explicit where it
matters? - Are critical assumptions visible? - Are alternative
explanations considered? - Are causal claims stronger than the
evaluation design permits? - Are unintended effects and guardrails
monitored?

## 27.18 Competence / task-analysis audit

Questions: - Does the procedure assume skills the target operator may
not have? - Was the real task observed or walked through for material
procedures? - Are interruptions, handoffs, degraded states, and
error-likely steps represented? - Does the playbook incorrectly rely on
documentation as a substitute for training or authorization?

## 27.19 Traceability audit

Questions: - Can material requirements and claims be traced to
recommendations and controls? - Can critical controls be traced to
current tests? - Are there orphan tests, orphan requirements, or stale
evidence links? - Can change impact be assessed bidirectionally?

## 27.20 Implementation-outcome audit

Questions: - Are adoption, appropriateness, feasibility,
fidelity/adaptation, reach, cost, and sustainment distinguished from end
outcomes where relevant? - Could a failed rollout be mistaken for a
failed recommendation, or vice versa?

## 27.21 Assurance / auditability audit

Questions: - Could an independent competent reviewer reconstruct the
material decision path? - Is reviewer independence adequate for the
risk? - Does the evidence package contain actual-use evidence rather
than template conformance alone? - Are findings tracked to closure?

------------------------------------------------------------------------

# 28. Testing strategy

Testing SHOULD match risk.

## T1 — Desk review

Reviewer checks: - logic; - evidence; - ambiguity; - consistency; -
missing paths.

## T2 — Tabletop scenario

Team walks through hypothetical scenarios without live execution.

Good for: - response playbooks; - strategic decisions; -
cross-functional workflows.

## T3 — Dry run

User executes in a safe/test environment.

Good for: - runbooks; - software operations; - process instructions.

## T4 — Shadow execution

Playbook is followed alongside current practice before replacing it.

Good for: - important business workflows; - migration to a new operating
model.

## T5 — Supervised live execution

Use real work with an experienced reviewer observing.

## T6 — Adversarial / edge-case test

Deliberately test: - incomplete input; - conflicting input; - failure; -
unexpected state; - permission issue; - time pressure; - ambiguous case.

## T7 — Regression test

After a material change, rerun relevant scenarios.

A change that fixes one Play MUST NOT silently break another.

## T8 — Implementation pilot

Use a bounded rollout to test:

- adoption;
- appropriateness/fit;
- feasibility;
- training/support;
- protected invariants vs local adaptation;
- operational burden;
- implementation cost;
- early guardrail signals.

Good for new organization-wide practices and behavior-changing
playbooks.

## T9 — Outcome / impact evaluation

When the decision requires evidence of real-world effect, evaluate the
intended outcomes with a design proportionate to the causal claim and
decision stakes.

Good for: scaling a novel intervention; retiring a major control;
claiming material business impact; comparing alternative operating
models.

T9 is not mandatory for every playbook.

------------------------------------------------------------------------

# 29. Defect severity

Use defect severity rather than one global quality score.

**BLOCKER** - unsafe; - materially wrong; - requirement violation; -
impossible execution; - critical missing branch; - unsupported
high-impact claim.

**MAJOR** - likely to cause wrong decision or failed execution; -
important ambiguity; - missing role/permission; - stale critical
information.

**MINOR** - friction or clarity issue unlikely to change outcome.

**EDITORIAL** - formatting, wording, non-material consistency.

A playbook cannot reach `VALIDATED` with unresolved BLOCKER defects.

High-risk playbooks SHOULD have no unresolved MAJOR defects unless
formally accepted.

------------------------------------------------------------------------

# 30. Definition of Ready

A playbook is ready to be built when:

- [ ] purpose is clear;
- [ ] primary users are defined;
- [ ] outcomes are defined;
- [ ] scope/out-of-scope are defined;
- [ ] primary archetype is selected;
- [ ] risk/rigor level is selected;
- [ ] owner is identified or explicitly TBD during drafting;
- [ ] research questions are defined;
- [ ] question types and appropriate research/review designs are
  selected for material evidence needs;
- [ ] source strategy is defined;
- [ ] known constraints are listed.
- [ ] stakeholder/user groups that can materially change the design are
  identified.
- [ ] implementation/adoption implications are scoped.
- [ ] the need for a Theory of Change/causal model and formal evaluation
  has been decided.
- [ ] competence/task-analysis needs are identified for material
  procedures.
- [ ] traceability/assurance requirements are selected for R3/R4.
- [ ] conflicts/incentives requiring management are identified for
  R3/R4.
- [ ] automation/autonomy scope is identified if the playbook can
  trigger machine actions.

------------------------------------------------------------------------

# 31. Definition of Done

A playbook can become `VALIDATED` only when all applicable conditions
pass.

## Scope and architecture

- [ ] Purpose and scope are unambiguous.
- [ ] Audience is explicit.
- [ ] The artifact type matches the problem.
- [ ] Principles, decisions, actions, and verification are
  distinguishable.
- [ ] Navigation supports actual use.

## Evidence

- [ ] Applicable authoritative sources were checked.
- [ ] Material claims are traceable.
- [ ] Contradictory evidence was actively sought.
- [ ] Context-dependent claims state conditions.
- [ ] Emerging practices are labeled.
- [ ] House standards are labeled.
- [ ] Evidence cutoff is recorded.
- [ ] Evidence certainty is not conflated with recommendation strength.
- [ ] Applicability/implementation factors were considered for material
  recommendations.
- [ ] Relevant conflicts/incentives were disclosed and managed for
  R3/R4.
- [ ] The evidence-synthesis method fits the material question types.
- [ ] R3/R4 research provenance is reproducible enough for competent
  review.
- [ ] Method-specific appraisal/search peer review was used where
  warranted.

## Execution

- [ ] Inputs are known.
- [ ] Outputs are defined.
- [ ] Acceptance criteria exist where meaningful.
- [ ] Roles and decision rights are clear where needed.
- [ ] Failure and escalation paths exist where risk warrants.
- [ ] Tools/templates were checked.
- [ ] Required competence is explicit for material procedures.
- [ ] Task analysis/operator walkthrough informed R3/R4 procedures where
  human execution risk is material.
- [ ] Protected invariants and allowed adaptation are explicit where
  local adaptation is expected.

## Testing

- [ ] Representative scenarios were tested.
- [ ] A competent non-author user challenged or executed material
  procedures where applicable.
- [ ] Relevant edge cases were tested.
- [ ] Representative intended users/stakeholders validated material
  guidance where applicable.
- [ ] Accessibility/human-factors issues were checked for critical
  instructions.
- [ ] Machine-executable Plays passed applicable control/adversarial
  tests.
- [ ] BLOCKER defects are zero.
- [ ] MAJOR defects are zero or explicitly accepted under the applicable
  governance model.
- [ ] Implementation/adoption was piloted where rollout risk warrants.
- [ ] Outcome/impact evaluation was performed or explicitly scoped out
  with rationale where causal claims matter.

## Governance

- [ ] Owner is named.
- [ ] Version/status are set.
- [ ] Canonical location is known.
- [ ] Change log exists.
- [ ] Review cadence and event triggers are defined.
- [ ] Superseded artifacts are linked/deprecated appropriately.
- [ ] Implementation/adoption plan exists where behavior change is
  required.
- [ ] R3/R4 traceability and assurance evidence are retained.
- [ ] Independent/domain review was completed where required by
  rigor/risk.
- [ ] Surveillance/update decision rules are defined for volatile
  guidance.

## Learning

- [ ] At least one meaningful effectiveness signal is defined.
- [ ] Implementation signals are separated from end outcomes where
  relevant.
- [ ] Guardrail/unintended-effect signals are defined where material.
- [ ] Evidence-to-decision rules exist for
  continue/iterate/scale/pause/retire where material.
- [ ] A feedback path exists.
- [ ] Users can report defects or exceptions.

------------------------------------------------------------------------

# 32. Lifecycle and statuses

Use:

``` text
DRAFT
  ↓
REVIEWED
  ↓
TESTED
  ↓
VALIDATED
  ↓
SUPERSEDED or DEPRECATED
```

## DRAFT

Content is incomplete or unverified.

MUST NOT be represented as approved production guidance.

## REVIEWED

A qualified reviewer has challenged content and evidence.

This does not mean it has been proven in use.

## TESTED

Defined tests have been executed.

Scope of testing SHOULD be recorded.

## VALIDATED

The artifact has passed its applicable Definition of Done and
demonstrated fitness for intended use.

## SUPERSEDED

A newer canonical artifact replaces it.

A superseded file SHOULD link to its replacement and SHOULD NOT remain
the easy default.

## DEPRECATED

It should no longer be used, but may remain for history/audit.

------------------------------------------------------------------------

# 33. Versioning

Recommended semantic logic:

**MAJOR** - changes meaning, operating model, critical decision logic,
or compatibility; - users may need migration/retraining.

**MINOR** - adds backward-compatible Plays, methods, guidance, or
evidence.

**PATCH** - clarifies wording; - repairs non-material errors; - updates
links/references without changing operating meaning.

Example:

``` text
2.3.1
│ │ └─ patch
│ └─── minor
└───── major
```

For regulated environments, use the applicable document-control model
instead.

------------------------------------------------------------------------

# 34. Change control

Every material release SHOULD record:

``` yaml
version:
date:
author:
reviewer:
reason_for_change:
sections_changed:
behavior_or_decision_impact:
evidence_added_or_removed:
tests_run:
migration_required:
approved_by:
```

Changes SHOULD be assessed for:

- downstream artifacts;
- linked templates;
- agent prompts/tools;
- training;
- integrations;
- tests;
- archived copies.

Microsoft operational guidance supports version-controlled, living
documentation with visible authorship/review and regular challenge.
\[S11\]

------------------------------------------------------------------------

# 35. Review cadence and triggers

Scheduled review alone is insufficient.

## 35.1 Event-triggered review

Review when:

- law/regulation changes;
- standard changes;
- platform/API changes;
- incident exposes a gap;
- outcome metrics deteriorate;
- users repeatedly deviate;
- important new evidence appears;
- organization structure/roles change;
- toolchain changes;
- a key assumption fails.

## 35.2 Scheduled review

Base interval on: - volatility; - risk; - frequency of use; - history of
change.

Do not create arbitrary review bureaucracy for stable low-risk content.

## 35.3 Surveillance decision

A review SHOULD end in an explicit disposition rather than “reviewed”:

- **retain** — still current; no material change;
- **refresh** — usability/editorial/reference update without changing
  intent;
- **partial update** — selected recommendations/Plays require
  re-evaluation;
- **full update** — scope, evidence base, or operating model requires
  major redevelopment;
- **withdraw/deprecate** — guidance is no longer valid, safe, useful, or
  owned;
- **watch** — no current change, but a named draft/event may soon
  require one.

NICE uses analogous surveillance choices to keep published guidance
current and distinguishes substantive updates from usability refreshes.
\[S65\]

------------------------------------------------------------------------

# 36. Measurement

A playbook SHOULD be measured as an operating capability, not by page
count, citation count, or template compliance.

## 36.1 Readiness signals

- required competence present;
- tools/permissions available;
- critical prerequisites satisfied;
- training/rehearsal complete where required.

## 36.2 Implementation signals

Select only what matters:

- reach/coverage;
- adoption;
- appropriateness;
- feasibility;
- fidelity to protected invariants;
- quality of local adaptations;
- implementation cost/burden;
- sustainment.

Implementation success is not proof of end-outcome success. \[S52\]
\[S53\]

## 36.3 Execution signals

- task success;
- error rate;
- rework;
- exceptions;
- escalation rate;
- time-to-outcome;
- handoff defects;
- recovery success.

## 36.4 Outcome / impact signals

Depend on domain and the Theory of Change.

Examples:

- incident recovery and recurrence;
- incremental profit or avoided cost;
- customer activation/retention;
- defect escape rate;
- validation learning velocity;
- decision quality/cycle time;
- safety or compliance outcomes.

Where causal claims matter, the evaluation design — not the metric alone
— determines what can be concluded.

## 36.5 Guardrail and unintended-effect signals

Track material downsides that could make a locally successful metric
harmful:

- safety/security events;
- accessibility/exclusion;
- quality degradation;
- cost displacement;
- gaming or perverse incentives;
- employee/customer burden;
- privacy/compliance issues;
- downstream failure.

## 36.6 Knowledge-health signals

- stale references;
- overdue reviews;
- unresolved defects;
- duplicated rules;
- percentage of critical Plays tested;
- traceability breaks;
- user-reported clarity defects;
- time from source change to impact assessment.

## 36.7 Learning signals

- number and quality of improvements;
- repeated failure recurrence;
- assumptions invalidated;
- adaptations retained/reverted;
- time from new evidence to playbook update;
- audit findings closed;
- decisions changed by evaluation evidence.

## 36.8 Metric integrity

For each material metric, define:

- decision/use;
- owner;
- population/denominator;
- source and data quality;
- baseline/comparator where relevant;
- cadence;
- threshold/decision rule;
- known gaming or interpretation risk.

Do not optimize an easy process metric if it undermines the real
outcome.

------------------------------------------------------------------------

# 37. Learning and continuous improvement

After meaningful use, ask:

1.  What were we trying to achieve?
2.  What actually happened?
3.  Why did the result differ?
4.  What should be sustained, changed, removed, or tested next?

This is consistent with Google SRE postmortem culture, NASA’s
lessons-learned lifecycle, and APQC knowledge-flow practice: learning
creates value only when it is disseminated, applied, and changes future
work. \[S13\] \[S66\] \[S67\]

Learning MUST result in one of: - no change, with rationale; - playbook
change; - tooling change; - training change; - system/process change; -
new experiment; - escalation to unresolved risk.

A retrospective with no follow-through is documentation, not learning.

------------------------------------------------------------------------

# 38. Governance

## 38.1 Owner

The owner is accountable for: - fitness for purpose; - current status; -
review; - defect triage; - change approval routing; - deprecation.

The owner does not need to write every section.

## 38.2 Reviewer

Reviewer SHOULD have enough independence and competence to challenge: -
assumptions; - evidence; - usability; - risk.

For R3/R4, avoid relying solely on the author as reviewer.

## 38.3 Contributors

Contributors MAY include: - subject-matter experts; - operators; -
customers/users; - legal/security/compliance; - data/analytics; -
researchers; - designers; - engineers.

## 38.4 Decision owner

For material unresolved choices, name who can decide.

A committee is not automatically a decision owner.

## 38.5 Exceptions

Exception record:

``` yaml
rule:
exception:
reason:
risk:
compensating_control:
owner:
approved_by:
expires:
review_trigger:
```

Permanent exceptions SHOULD be incorporated into the standard or
explicitly rejected, not allowed to live indefinitely as invisible
workarounds.

## 38.6 Conflicts and editorial independence

For R3/R4 playbooks, relevant authors, reviewers, and decision owners
SHOULD declare material interests that could bias recommendation
formulation.

The release record SHOULD state:

- material conflicts identified;
- how they were managed;
- whether conflicted contributors were excluded from specific decisions;
- whether funders/vendors influenced content;
- who performed independent review.

This is an adapted cross-domain control informed by AGREE II and NICE
governance practice. \[S38\] \[S35\]

------------------------------------------------------------------------

# 39. Repository, access, security, and document control

A production playbook is part of an information system, not just a file.

## 39.1 Canonical source

Every production artifact MUST have one identifiable canonical source.

Copies MAY exist for convenience, but they MUST NOT create ambiguity
about which version governs current work.

Recommended controls:

- stable canonical location;
- version history;
- owner;
- current status;
- last review date;
- links to superseding/superseded versions;
- dependency links to related Plays, runbooks, tools, and templates.

AWS and Microsoft operational guidance both emphasize central,
maintained documentation and version control. ISO 10013 emphasizes the
development and maintenance of documented information suited to the
organization. \[S02\] \[S09\] \[S11\]

## 39.2 Discoverability

A correct playbook that users cannot find is operationally weak.

Repositories SHOULD support:

- meaningful names;
- stable IDs;
- search;
- tags or domain metadata where scale warrants;
- links from the workflows where the artifact is actually needed;
- a clear index or map for large playbook systems.

Do not solve poor information architecture by creating duplicate copies
everywhere.

## 39.3 Access control

Playbook access SHOULD match information sensitivity and operational
need.

For sensitive or controlled artifacts:

- apply least-privilege write access;
- separate authoring/approval rights where required;
- ensure intended operators can access the playbook when needed;
- protect personal, confidential, regulated, or security-sensitive data;
- record material approvals where the domain requires auditability.

A response playbook that is inaccessible during the incident is not
usable. Critical response artifacts SHOULD therefore consider
availability under degraded conditions.

## 39.4 Secrets and sensitive operational data

Playbooks MUST NOT embed live secrets, private keys, passwords, tokens,
or equivalent credentials.

Reference the approved secret-management mechanism instead.

Examples and screenshots MUST be sanitized when they could reveal:

- personal data;
- credentials;
- customer secrets;
- internal security details beyond the intended audience;
- regulated information.

## 39.5 Integrity

Controlled playbooks SHOULD make unauthorized or accidental change
detectable through appropriate repository/version controls.

For higher-risk environments, consider:

- protected branches or equivalent approval controls;
- signed releases where justified;
- immutable audit history;
- explicit approvers;
- separation of duties.

The implementation MUST match the actual risk; these controls are not
mandatory bureaucracy for low-risk guidance.

## 39.6 Availability and continuity

For critical operations, determine what happens if the normal
documentation system is unavailable.

Possible controls include:

- approved offline/exported emergency copy;
- secondary read-only location;
- documented break-glass access;
- periodic access test.

The copy strategy MUST include a way to prevent stale emergency copies
from silently becoming authoritative.

## 39.7 Intellectual property and source rights

Research traceability does not authorize copying protected material.

Authors SHOULD:

- link and cite sources;
- paraphrase rather than reproduce long proprietary passages;
- respect applicable licenses;
- identify externally licensed templates/code where reuse terms matter;
- avoid embedding third-party content whose rights are unclear.

This standard synthesizes external sources; it does not reproduce paid
standards in full.

## 39.8 Dependency and change-impact control

A material change SHOULD identify affected downstream artifacts.

Examples:

``` text
Principle
  ├── PLAY-04
  │    ├── RUN-04A
  │    └── TEMPLATE-04
  └── PLAY-09
       └── DECISION-TABLE-09
```

When the principle changes, all dependent artifacts SHOULD be reviewed.

This becomes especially important when AI agents or automations execute
the same artifacts: a text change can become a behavior change.

------------------------------------------------------------------------

# 40. Canonical metadata

Recommended front matter:

``` yaml
document_id:
title:
artifact_type:
primary_archetype:
version:
status:
owner:
reviewers:
independent_reviewers:
conflicts_of_interest:
created:
last_updated:
last_reviewed:
evidence_cutoff:
rigor_level:
volatility:
research_or_review_design:
causal_model_required:
implementation_plan_required:
evaluation_plan_required:
assurance_level:
next_review:
review_triggers:
applies_to:
out_of_scope:
supersedes:
superseded_by:
canonical_location:
related_artifacts:
implementation_owner:
evaluation_owner:
assurance_owner:
accessibility_requirements:
automation_scope:
```

Only fields with management value SHOULD be retained.

------------------------------------------------------------------------

# 41. Research templates

## 41.1 Playbook brief

``` markdown
# Playbook Brief

## Problem
What recurring problem, decision, or capability needs support?

## Intended users
Who will use it, with what baseline competence?

## Affected stakeholders
Who is materially affected even if they do not execute the playbook?

## Intended outcomes
What should improve in the real world?

## Scope
Included:

Excluded:

## Primary archetype
Operating / Execution / Decision / Discovery / Response / Capability / Hybrid

## Risk / rigor
L1 / L2 / L3 / L4

Why:

## Volatility
Stable / Moderate / Fast / Real-time

## Critical questions
1.
2.
3.

## Known authorities / constraints
-

## Implementation / adoption
What behavior, process, training, tooling, or ownership must change?

## Independence / conflicts
Any known vendor, funder, author, or reviewer interests that require management?

## Automation scope
Human-only / assisted / semi-autonomous / autonomous; side-effect classes allowed:

## Definition of success
-
```

## 41.2 Research protocol

``` markdown
# Research Protocol

## Research question

## Question type(s)
Requirement / descriptive / causal / diagnostic / predictive / experiential /
economic / implementation / risk / normative

## Review / research design
Scoping / systematic / rapid / mixed-methods / theory-based / official-source
verification / organizational-data analysis / experiment / qualitative / other

Why this design fits:

## Decision supported

## Subquestions

## Source families
- Authoritative:
- Research:
- Organizational:
- Practitioner:
- Stakeholder:

## Critical outcomes / decision criteria
Defined before synthesis where hindsight bias is material:

## Stakeholder / implementation evidence
Users/operators affected:
Barriers/facilitators to investigate:
Resource/feasibility questions:
Accessibility/equity questions:

## Conflict / independence plan
Relevant interests:
Independent review required?:

## Search strategy
Sources/platforms:
Query logic:
Search-log location:
Information specialist / PRESS-style peer review required?:
Independent screening/extraction required?:

## Freshness requirements

## Inclusion criteria

## Exclusion criteria

## Contradiction searches

## Stop criteria

## Evidence cutoff
```

## 41.3 Search log

``` markdown
| Date | Query / route | Source universe | Filters | Results reviewed | Included | Notes |
|---|---|---|---|---:|---:|---|
| | | | | | | |
```

Use for R3/R4 or unusually deep research. It is optional for lean work.

------------------------------------------------------------------------

# 42. Evidence templates

## 42.1 Source register

``` markdown
| Source ID | Source | Class | Date/version | Claim/use | Context fit | Limitations | Status |
|---|---|---|---|---|---|---|---|
```

## 42.2 Claim-evidence matrix

``` markdown
| Claim ID | Claim | Type | Confidence | Supporting evidence | Contradicting evidence | Conditions | Decision impact |
|---|---|---|---|---|---|---|---|
```

## 42.3 Uncertainty register

``` markdown
| Unknown | Why it matters | Current evidence | Risk if wrong | How to resolve | Owner | Trigger/date |
|---|---|---|---|---|---|---|
```

## 42.4 Evidence-to-Recommendation record

``` markdown
| Dimension | Evidence / judgment | Confidence | Decision impact |
|---|---|---|---|
| Expected benefit | | | |
| Harms / downsides | | | |
| Context fit | | | |
| Stakeholder values | | | |
| Feasibility | | | |
| Resources / cost | | | |
| Acceptability | | | |
| Accessibility / equity | | | |
| Alternatives | | | |
| Reversibility | | | |
| Implementation barriers | | | |

Recommendation:
Strength/classification:
Exceptions:
Revisit trigger:
```

------------------------------------------------------------------------

# 43. Validation templates

## 43.1 Scenario test

``` markdown
# Scenario Test

Scenario:
User:
Environment:
Playbook version:

## Starting state

## Intended outcome

## Path expected

## Observed behavior

## Result
PASS / FAIL / PARTIAL

## Defects
- Severity:
- Location:
- Description:
- Recommended change:

## New edge cases discovered

## Retest required
```

## 43.2 Non-author execution test

``` markdown
Tester:
Baseline competence:
Artifact:
Version:

Could tester find the right starting point? Y/N
Could tester identify required inputs? Y/N
Could tester execute without coaching? Y/N
Did tester produce acceptable output? Y/N
Did tester encounter ambiguity? Y/N
Did tester create unsafe/unintended behavior? Y/N

Observed questions:
Observed deviations:
Missing context:
Recommended changes:
```

## 43.3 QA release record

``` markdown
| Gate | Status | Reviewer | Evidence / test | Blocking defects |
|---|---|---|---|---|
| Scope | | | | |
| Evidence | | | | |
| Architecture | | | | |
| Verification | | | | |
| Validation | | | | |
| Governance | | | | |
```

## 43.4 Automation / agent execution test

``` markdown
Artifact:
Version:
Environment:
Side-effect class:

Permissions least-privilege verified: Y/N
Untrusted-input boundaries tested: Y/N
Preconditions/postconditions validated: Y/N
Output schema validation tested: Y/N
Retry/idempotency behavior tested where relevant: Y/N/N/A
Concurrency/duplicate-action behavior tested where relevant: Y/N/N/A
Approval boundary tested: Y/N/N/A
Timeout/loop/cost limits tested: Y/N/N/A
Logging/provenance sufficient: Y/N
Monitoring/alert path tested: Y/N
Stop/recovery path tested: Y/N
Adversarial/misuse scenarios tested: Y/N

Defects:
Residual risk:
Approver:
```

## 43.5 Theory-of-Change / evaluation plan

``` markdown
# Theory of Change and Evaluation Plan

Problem:
Target users/system:
Intended decision use:

| Link | Assumption / mechanism | Evidence | Measure | Alternative explanation | Risk if wrong |
|---|---|---|---|---|---|
| Input → activity | | | | | |
| Activity → intermediate change | | | | | |
| Intermediate change → outcome | | | | | |

Unintended outcomes / guardrails:
Baseline/comparator:
Process evaluation:
Implementation evaluation:
Outcome/impact evaluation:
Value/cost evaluation:
Decision thresholds:
Continue / iterate / scale / pause / retire rules:
```

## 43.6 Implementation plan

``` markdown
# Implementation Plan

Target adopters:
Current process/behavior replaced:
Implementation owner:
Protected invariants:
Allowed local adaptations:

## Context
Outer-setting factors:
Inner-setting factors:
People/competence factors:
Workflow/tool factors:
Incentives/culture factors:

## Enablement
Training/rehearsal:
Tools/permissions:
Champions/support:
Rollout/pilot:
Old guidance retirement:

## Implementation outcomes
Reach:
Adoption:
Appropriateness:
Feasibility:
Fidelity/adaptation:
Cost:
Sustainment:

## Decision rules
Pause:
Iterate:
Scale:
Rollback:
```

## 43.7 Traceability matrix

``` markdown
| ID | Requirement / claim | Evidence | Recommendation / control | Play / artifact | Test | Outcome signal | Status |
|---|---|---|---|---|---|---|---|
```

## 43.8 Audit plan and findings

``` markdown
# Audit Plan

Objective:
Scope:
Criteria:
Risk focus:
Auditor/reviewers:
Independence:
Competence:
Evidence sample:
Methods:
Users/executions observed:

## Findings
| Finding | Criterion | Evidence | Severity | Owner | Action / acceptance | Due | Closure evidence |
|---|---|---|---|---|---|---|---|
```

------------------------------------------------------------------------

# 44. Decision templates

## 44.1 Decision table

``` markdown
| Condition | Evidence needed | Decision/action | Approval | Escalation |
|---|---|---|---|---|
```

## 44.2 Decision record

``` markdown
# Decision [ID]

Date:
Owner:
Status:

## Decision

## Intended outcome

## Context

## Constraints

## Alternatives considered

## Criteria

## Evidence

## Assumptions and uncertainty

## Trade-offs

## Rationale

## Consequences

## Revisit triggers
```

------------------------------------------------------------------------

# 45. Anti-patterns

## 45.1 The encyclopedia

Symptom: - huge document; - hard to act; - no clear decision layer.

Fix: - separate reference from execution; - progressive disclosure; -
modular Plays.

## 45.2 The checklist masquerading as a playbook

Symptom: - many boxes; - no context; - no judgment support.

Fix: - add principles, decision logic, conditions.

## 45.3 The SOP masquerading as strategy

Symptom: - linear steps for a problem with high uncertainty.

Fix: - use Discovery or Decision Play architecture.

## 45.4 Consultant authority laundering

Symptom: - “McKinsey says X, therefore X is best practice.”

Fix: - appraise method, directness, context, and independent
corroboration.

## 45.5 Academic abstraction

Symptom: - correct theory; - no operational translation.

Fix: - translate Principle → Decision → Action → Verification.

## 45.6 False universality

Symptom: - words such as “always” or “never” without real necessity.

Fix: - state conditions and exceptions.

## 45.7 Source count as evidence quality

Symptom: - 20 sources all repeat the same original claim.

Fix: - track source independence and provenance.

## 45.8 Premature procedure

Symptom: - detailed process before outcome/problem is understood.

Fix: - scope and discovery first.

## 45.9 Documentation theatre

Symptom: - every template field filled; - nobody uses it; - no
measurable outcome.

Fix: - delete fields without execution value.

## 45.10 Hidden decision rights

Symptom: - everyone can advise; - nobody knows who decides.

Fix: - explicit decision owner and escalation.

## 45.11 Verification without validation

Symptom: - every section passes QA; - real users cannot use it.

Fix: - user/scenario testing.

## 45.12 Validation without evidence

Symptom: - “people like the playbook” but core claims are wrong.

Fix: - evidence gate plus user validation.

## 45.13 Stale certainty

Symptom: - old instructions remain marked `VALIDATED` after platform
change.

Fix: - event-triggered review and evidence cutoff.

## 45.14 One-number quality score

Symptom: - complex trade-offs hidden behind “92/100.”

Fix: - gate status + defect severity + explicit evidence.

## 45.15 Copy-paste drift

Symptom: - same rule appears in five places with different wording.

Fix: - one canonical rule, references elsewhere.

## 45.16 Evidence-is-the-decision

Symptom: - strong evidence of an effect is treated as sufficient reason
to mandate an action without considering harms, feasibility, resources,
stakeholder values, or alternatives.

Fix: - run the Evidence-to-Recommendation gate.

## 45.17 Publish-and-pray

Symptom: - the playbook is released with no training, rollout,
ownership, local adaptation rules, or feedback path.

Fix: - design implementation and adoption as part of the artifact.

## 45.18 Hidden incentives

Symptom: - vendor, author, reviewer, or funder interests shape the
recommendation but are not visible.

Fix: - disclose and manage conflicts; add independent review where risk
warrants.

## 45.19 Human-error blame

Symptom: - repeated user mistakes are treated as individual failure even
though instructions, cognitive load, accessibility, or handoffs are
defective.

Fix: - run human-factors/accessibility testing and redesign the system.

## 45.20 Autonomous ambiguity

Symptom: - human-oriented prose is handed to an agent with broad
permissions, undefined side effects, no schema validation, and no
monitoring.

Fix: - add explicit machine-execution controls or keep the Play
human-only.

## 45.21 Procedure-as-competence

Symptom: - a detailed procedure is used to justify assigning work to
someone without the required skill, authorization, supervision, or
training.

Fix: - define competence prerequisites and use
training/rehearsal/escalation as separate controls.

## 45.22 Implementation-metric substitution

Symptom: - adoption, completion, or training rate is presented as proof
that the playbook improved the end outcome.

Fix: - separate implementation, process, outcome, and guardrail
measures.

## 45.23 Causal overclaim

Symptom: - a before/after improvement is attributed to the playbook
without a credible comparator, causal model, or alternative-explanation
analysis.

Fix: - match the causal claim to the evaluation design and downgrade the
claim when attribution is weak.

## 45.24 Framework cargo cult

Symptom: - CFIR, GRADE, RAPID, PRISMA, or another respected framework is
copied into a domain where its constructs add burden without decision
value.

Fix: - extract the relevant principle, preserve the framework’s scope
limits, and use the full method only when the question warrants it.

## 45.25 Research maximalism

Symptom: - research continues because more sources can be found, not
because remaining uncertainty could change a decision.

Fix: - use decision-linked stop criteria and target the highest-value
unknowns.

## 45.26 Audit-by-template

Symptom: - an artifact “passes” because every required field exists
while real execution, competence, outcomes, and exceptions are never
sampled.

Fix: - audit objective evidence from actual or realistic operation.

------------------------------------------------------------------------

# 46. What is universal vs. contextual

This distinction is central.

## 46.1 Strong universal defaults in this standard

These are broadly supported and should rarely be omitted:

- purpose and intended outcome;
- scope;
- explicit inputs/outputs for executable work;
- clear ownership;
- evidence traceability for material claims;
- risk-proportionate rigor;
- verification;
- real-use validation appropriate to consequence;
- version/status control;
- feedback and maintenance;
- separation of evidence certainty from recommendation strength;
- implementation/applicability assessment for material behavior-changing
  guidance;
- clear, accessible instructions appropriate to intended users;
- explicit competence assumptions for material procedures;
- separation of implementation success from end-outcome success;
- causal assumptions/evaluation proportional to the strength of material
  outcome claims;
- independent/auditable assurance for high-rigor work.

## 46.2 Contextual mechanisms

These are useful but not universally required:

- RAPID;
- RACI;
- DACI;
- OKRs;
- design thinking sequences;
- interview sample counts;
- weighted scoring matrices;
- sprint cadence;
- specific prioritization methods;
- maturity models;
- incident severity schemes;
- a fixed number of customer interviews;
- a specific research database;
- a single “best” software stack;
- full CFIR/RE-AIM/PRISM use;
- a formal Theory-of-Change diagram for every low-risk playbook;
- systematic-review methods for questions that do not require them;
- a fixed audit sample size independent of risk and population.

A mature playbook teaches **when** a mechanism is useful rather than
making the mechanism the doctrine.

------------------------------------------------------------------------

# 47. Design implications from major source families

## 47.1 ISO

**What we adopt** - process orientation; - context; -
leadership/ownership; - documented information; - performance
evaluation; - continual improvement; - risk-aware planning; - tailoring
documentation to need.

**What we do not claim** - that this playbook standard itself is ISO
9001 certified; - that ISO requires this exact artifact hierarchy.

ISO 9001:2026 is the current edition as of this evidence cutoff,
published 16 September 2026. ISO 10013:2021 remains the principal
published ISO guidance reviewed here for documented information. \[S01\]
\[S02\]

## 47.2 NIST

**What we adopt** - modular playbook design; - tailoring to context; -
living-resource mindset; - risk mapping and explicit outcomes; -
avoidance of treating a playbook as an exhaustive ordered checklist.

NIST’s AI RMF itself is under revision as of the evidence cutoff, so its
specific AI content is not treated as a permanent normative base for
this general standard. \[S05\] \[S06\]

## 47.3 IETF

**What we adopt** - disciplined requirement language; - explicit meaning
for normative keywords.

We adapt the concept rather than pretending this document is an Internet
Standard. \[S08\]

## 47.4 NASA

**What we adopt** - rigor proportional to consequence/complexity; -
explicit decision analysis; - assumptions and uncertainty; -
input/activity/output thinking; - verification vs. validation; -
traceability of decisions and lessons.

NASA’s handbook is safety/mission engineering guidance. Its exact
controls are not transplanted wholesale into low-risk business
workflows. \[S14\]

## 47.5 AWS / Microsoft / Google SRE

**What we adopt** - playbook/runbook distinction; -
permissions/tools/error/escalation in procedures; - validation by
another operator; - living version-controlled documentation; - incident
roles; - rehearsal; - post-event learning.

Cloud/SRE practices are operational evidence, not a claim that all
business playbooks are incident-management systems. \[S09\] \[S10\]
\[S11\] \[S12\] \[S13\]

## 47.6 Evidence-Based Management / PRISMA

**What we adopt** - systematic questions; - multiple evidence streams; -
critical appraisal; - transparent search/synthesis; - explicit
limitations.

We do not require every playbook research task to become a formal
systematic review. \[S16\] \[S17\] \[S18\]

## 47.7 Stanford / Harvard / Wharton

**What we adopt** - avoid rigid one-process thinking; - design the
process for the problem; - navigate ambiguity; - learn from
stakeholders/context; - experiment; - use structured reflection; - begin
analytics from decisions/questions rather than available data.

These sources are especially important for Discovery, Decision, and
human-centered Plays. \[S19\] \[S20\] \[S21\] \[S22\] \[S30\]

## 47.8 Consultancies and applied practitioner frameworks

**What we adopt selectively** - operating-model integration; - decision
rights; - capability building; - practical exercise design; -
experimental validation.

Their value lies in applied patterns and experience. Brand prestige does
not exempt claims from evidence appraisal. \[S23\] \[S24\] \[S25\]
\[S27\] \[S28\]

## 47.9 GRADE / NICE / AGREE

Contributed: - evidence certainty is distinct from recommendation
strength; - protocol-first evidence review; - explicit
evidence-to-decision reasoning; - stakeholder involvement; -
applicability and implementation considerations; - editorial
independence and conflict management.

Constraint: - these frameworks originate in health/guideline contexts;
this standard adapts their general decision-quality mechanisms rather
than importing domain-specific clinical rules.

## 47.10 FAA / WHO / W3C

Contributed: - human factors require professional judgment; - checklist
brevity and critical-item discipline; - local adaptation with protected
invariants; - implementation through training, champions, coaching, and
feedback; - clear, structured, accessible instructions.

## 47.11 APQC

Contributed: - common process language; - hierarchical decomposition; -
process definitions and measures; - ownership and maintenance of process
documentation.

## 47.12 NIST AI assurance / OWASP / SLSA

Contributed: - TEVV and adversarial testing; - human oversight; -
provenance; - post-deployment monitoring; - least-privilege and approval
boundaries for agentic execution; - software/source provenance and
supply-chain verification.

Constraint: - agent-security practice is evolving quickly; OWASP
controls are applied guidance, while NIST and SLSA provide stronger
institutional/specification anchors.

## 47.13 Implementation science

CFIR, RE-AIM/PRISM, and the Proctor outcomes taxonomy contributed: -
implementation context/determinants; - explicit separation of
implementation outcomes from end outcomes; - adoption, reach,
feasibility, fidelity/adaptation, cost, and sustainment; - the need to
study context rather than treating rollout failure as content failure.

Constraint: these frameworks originate largely in health/public-health
implementation science. V2 uses their cross-domain distinctions and
prompts, not their full domain-specific measurement systems. \[S51\]
\[S52\] \[S53\]

## 47.14 Evaluation science / UK Magenta Book

Contributed: - Theory of Change; - alternative explanations and negative
programme theory; - process, impact, and value evaluation; - evaluation
planning before implementation; - proportionality; - triangulation; -
decision-linked evaluation and test-and-learn.

Constraint: government policy/program evaluation differs from many
business workflows. The causal/evaluation principles are generalized;
method selection remains contextual. \[S50\]

## 47.15 Evidence-synthesis methodology

Cochrane, JBI, PRISMA-S, PRESS, and NICE contributed: -
question/protocol-first review design; - fit-for-question evidence
methods; - reproducible searching; - systematic selection when
claimed; - critical appraisal; - search peer review for high-risk
complex searches; - transparent updating/surveillance.

Constraint: formal systematic-review methods can create unnecessary
overhead for simple authoritative-document questions. V2 explicitly
prohibits cargo-cult methodology. \[S57\] \[S58\] \[S59\] \[S60\]
\[S65\]

## 47.16 Audit and assurance

ISO 19011:2026 contributed: - audit-program thinking; - competence; -
independence; - evidence-based conclusions; - risk-based audit focus; -
follow-up.

The National Academies contributed external review, multidisciplinary
challenge, conflict management, and updating as trustworthy-guideline
mechanisms.

Constraint: neither source defines a universal business-playbook
certification scheme. V2’s assurance package remains a HOUSE synthesis.
\[S49\] \[S56\]

## 47.17 Human task analysis and competence

HSE and NASA contributed: - task analysis; - user/operator
involvement; - competence as a separate control; - error-likely
situations; - human-in-the-loop evaluation; - procedure/training
co-design.

Constraint: both are strongly influenced by safety-critical settings;
depth must remain risk-proportionate. \[S54\] \[S55\]

## 47.18 Knowledge flow and lessons learned

NASA and APQC contributed: - collecting and recording lessons is
insufficient; - knowledge must be disseminated, accessible, applied, and
fed into processes, training, checklists, and policy; - knowledge health
should be measured by reuse and business value, not document count.

\[S66\] \[S67\]

------------------------------------------------------------------------

# 48. Research sanity check for this release

## 48.1 What appears strongly supported

### A. Playbooks should be adaptable, not universally linear

Supported by: - NIST; - Stanford; - Atlassian; - ISO documentation
tailoring.

**Confidence: HIGH.**

### B. Known-path procedures should be separated from investigative/judgment-heavy work

Supported directly by AWS runbook/playbook distinctions and reinforced
by systems/process logic.

**Confidence: HIGH** for operational contexts; generalized here with
care.

### C. Documentation rigor should vary with risk and complexity

Supported by: - ISO risk-based management; - NASA systems engineering; -
AWS risk framing; - practical operational frameworks.

**Confidence: HIGH.**

### D. Independent/non-author execution is a strong validation method for procedures

Supported explicitly by AWS and consistent with verification principles.

**Confidence: HIGH** as a practical default for repeated material
procedures.

### E. Playbooks need ownership, versioning, review, and continual improvement

Supported by: - ISO; - ISO 10013; - Microsoft; - AWS; -
knowledge-management principles.

**Confidence: HIGH.**

### F. Evidence should be critically appraised and triangulated rather than selected by prestige

Supported by Evidence-Based Management and research-review methodology.

**Confidence: HIGH.**

### G. Verification and validation are distinct

Explicit in NASA systems engineering and broadly applicable by analogy.

**Confidence: HIGH** for the distinction; implementation must be
tailored.

### H. Learning loops improve the operating system when findings change behavior/system

Supported by: - ISO continual improvement; - Google SRE postmortems; -
Harvard organizational-learning work.

**Confidence: HIGH** as a general management/operations principle.

### I. Evidence certainty and recommendation strength are different judgments

Supported strongly in GRADE/Cochrane and NICE guideline methodology and
generalized here with care.

**Confidence: HIGH** for the distinction; the exact cross-domain gate is
a `HOUSE` adaptation. \[S35\] \[S36\] \[S37\]

### J. Applicability and implementation quality belong inside the standard

AGREE II treats applicability as a guideline-quality domain, WHO treats
implementation/training/local adaptation as essential to checklist
success, and APQC emphasizes ownership and maintenance of process
documentation.

**Confidence: HIGH** that publication alone is insufficient; specific
implementation methods remain contextual. \[S34\] \[S38\] \[S39\]

### K. Human factors and accessibility are reliability controls

FAA treats human factors as integral to safety/effectiveness and
requires expert judgment; W3C provides strong guidance on clear,
structured, understandable instructions.

**Confidence: HIGH** that clarity/cognitive ergonomics matter; exact
formatting requirements depend on delivery medium and user needs.
\[S33\] \[S40\]

### L. AI/agent playbooks need stronger execution and monitoring controls

NIST AI 600-1 emphasizes TEVV, human oversight and adversarial testing,
while NIST’s 2026 monitoring work highlights the limits of
pre-deployment evaluation. OWASP adds practical least-privilege and
high-impact-action controls.

**Confidence: HIGH** for the need for controls and monitoring;
**MODERATE** for specific agent-control defaults because the field is
evolving quickly. \[S41\] \[S42\] \[S43\]

### M. Implementation must be evaluated separately from intervention effect

CFIR identifies contextual determinants of implementation; RE-AIM/PRISM
and the Proctor taxonomy distinguish adoption, feasibility, fidelity,
cost, reach, and sustainment from end outcomes.

**Confidence: HIGH** for the distinction; **MODERATE** for direct
transfer of specific health-domain constructs to every business domain.
V2 therefore uses them as routing prompts rather than mandatory
universal fields. \[S51\] \[S52\] \[S53\]

### N. Causal claims need an explicit causal model and proportionate evaluation

The 2026 Magenta Book emphasizes Theory of Change, alternative
explanations, process evaluation, impact evaluation, value, and
proportionality.

**Confidence: HIGH** that material causal claims require stronger
reasoning than before/after metrics; the exact evaluation method remains
context-dependent. \[S50\]

### O. High-rigor research needs reproducible retrieval and fit-for-method appraisal

Cochrane, JBI, PRISMA-S, and PRESS converge on explicit question
framing, systematic search/selection where claimed, transparent
reporting, specialist search expertise for complex reviews, and peer
review of search strategies.

**Confidence: HIGH** for R3/R4 evidence syntheses; **LOW relevance** to
simple official-document lookups where formal evidence synthesis would
add no value. \[S57\] \[S58\] \[S59\] \[S60\]

### P. Audit quality depends on competence, independence, evidence, and risk focus

ISO 19011:2026 provides current guidance for management-system auditing
and auditor competence.

**Confidence: HIGH** for higher-rigor assurance; exact audit sampling
remains contextual. \[S49\]

### Q. Procedures should be grounded in real tasks and competence

HSE and NASA human-factors guidance converge on task analysis,
user/operator involvement, competence, and iterative testing rather than
assuming that more detailed written procedures eliminate human error.

**Confidence: HIGH** for material human-executed procedures. \[S54\]
\[S55\]

### R. AI evaluation should combine complementary evidence modes

NIST’s 2026 ARIA manual combines model testing, red teaming, and user
testing; NIST’s deployed-AI monitoring report emphasizes production
monitoring, while TEVV-Athlon remains an initial public draft.

**Confidence: HIGH** for multi-method and post-deployment evaluation;
**MODERATE/EMERGING** for the specific TEVV-Athlon framework until
finalized. \[S42\] \[S62\] \[S63\]

## 48.2 What is primarily a house synthesis

The following are deliberately designed for this system and should be
labeled `HOUSE` rather than claimed as externally standardized:

- the exact artifact hierarchy;
- the six Playbook archetypes;
- the `REQ/EST/DEF/CTX/EMG/HOUSE/EXP/UNK` labels;
- the four rigor levels;
- the exact status flow;
- semantic versioning for playbooks;
- stable Play IDs;
- the specific Definition of Done;
- the human+AI compatibility layer and its exact control fields;
- the exact Evidence-to-Recommendation table outside formal guideline
  domains;
- the exact QA gate sequence;
- the exact implementation-outcome routing table outside
  implementation-science domains;
- the exact Theory-of-Change and assurance templates;
- the exact traceability spine and threshold for when it becomes
  mandatory.

These choices are **derived from** external best practices but are not
themselves official ISO/NIST standards.

## 48.3 What remains uncertain / should be piloted

1.  Whether the six archetypes are sufficient across all planned
    domains.
2.  Whether the four rigor levels create the right amount of overhead.
3.  Whether claim labels are intuitive enough for daily human use.
4.  Whether source registers should live inline or as separate
    machine-readable data.
5.  How much metadata materially helps AI agents versus creates
    maintenance cost.
6.  Which QA gates can be automated without creating false confidence.
7.  What review cadence works best for fast-changing AI and advertising
    playbooks.
8.  Whether V2’s implementation/evaluation layer is lightweight enough
    for non-health business domains.
9.  Whether the traceability spine should be mandatory at R3 or only
    selected R3 plus all R4.
10. Which audit sample designs provide adequate assurance without
    creating documentation theatre.

These questions should be resolved through actual use rather than more
armchair specification.

------------------------------------------------------------------------

# 49. Prior cross-domain pilot results and V2 retest requirement

The three pilots below were performed against v1.0-RC2 and remain
valuable evidence about the architecture. They are preserved for
traceability.

**Important V2 rule:** v2.0-RC1 adds material implementation,
causal-evaluation, traceability, research-method, audit, competence, and
AI-evaluation controls. Therefore the RC2 pilot result does **not**
automatically confer `TESTED` status on V2. The three domains MUST be
rerun against V2 before promotion from `REVIEWED` to `TESTED`, followed
by representative non-author field execution before `VALIDATED`.

## Pilot A — Software / AI Engineering

**Archetype:** Operating + Capability + Execution + Response  
**Rigor:** R3 / CONTROLLED for production systems; R4 for
safety/security-critical operations.

### Mini-playbook architecture produced by the standard

1.  Purpose, system boundaries, threat/risk context
2.  Engineering principles and architecture constraints
3.  Requirements and acceptance criteria
4.  Secure development lifecycle
5.  Code review and change control
6.  Test strategy: unit → integration → end-to-end → security →
    resilience
7.  AI-specific evaluation/TEVV where applicable
8.  Dependency and software-supply-chain controls
9.  Release/deployment strategy
10. Observability and post-deployment monitoring
11. Incident response and recovery
12. Postmortem/learning
13. Metrics and governance
14. Plays/runbooks for recurring engineering outcomes

### Sample Play tested — Release a material production change

The Atomic Play Standard successfully forced: - objective and
preconditions; - risk/side-effect classification; - required tests and
evidence; - decision/approval rights; - provenance; - rollout and
rollback; - post-deploy verification; - monitoring; -
failure/escalation; - learning.

### Domain cross-check

The structure is compatible with NIST SSDF’s outcome-based
secure-development practices, Google SRE operational learning, NIST AI
600-1 for AI-specific TEVV, and SLSA 1.2 provenance/supply-chain
controls. \[S12\] \[S13\] \[S41\] \[S44\] \[S45\]

### Defects found

RC1’s human+AI section was too abstract for machine execution. It lacked
explicit: - side-effect/reversibility class; - pre/postconditions; -
schema validation; - idempotency/retry/concurrency; - bounded
execution; - observability; - post-deployment monitoring; - adversarial
agent tests.

**Historical disposition:** fixed in RC2 and retained/extended in V2
sections 20.9–20.16 plus the current automation/agent-control audit.

**Pilot result:** PASS after revision.

------------------------------------------------------------------------

## Pilot B — Market Validation / Business Design

**Archetype:** Discovery + Decision  
**Rigor:** usually R2; R3 when capital commitment, strategic lock-in, or
high opportunity cost is material.

### Mini-playbook architecture produced by the standard

1.  Opportunity/decision to be informed
2.  Customer/problem/context model
3.  Critical assumptions
4.  Assumption prioritization by consequence × uncertainty
5.  Evidence plan
6.  Experiment portfolio
7.  Evidence-strength and bias controls
8.  Synthesis
9.  Evidence-to-Recommendation gate
10. Stop / pivot / continue / invest decision
11. Learning repository and next uncertainty

### Sample Play tested — Validate a problem hypothesis

The revised standard produced: - falsifiable hypothesis; - affected
segment/context; - precommitted decision question; - mixed evidence
sources; - explicit contradiction search; - no arbitrary universal
interview count; - evidence threshold and confidence; - stakeholder
evidence; - alternative explanations; - resource/feasibility
implications; - stop/pivot/continue logic.

This is consistent with Stanford d.school’s emphasis on ambiguity,
synthesis and rapid experimentation, Strategyzer’s hypothesis/experiment
logic, Evidence-Based Management’s multi-source evidence model, and
Wharton’s decision-first framing. \[S16\] \[S19\] \[S21\] \[S28\]
\[S30\]

### Defects found

RC1 had evidence appraisal but did not sufficiently separate: -
**evidence certainty** from - **the recommendation/commitment
decision**.

It also under-specified stakeholder values, feasibility, resources,
implementation barriers, and conflict/incentive management.

**Disposition:** fixed through P16–P19, sections 8.8–8.10, 9.7–9.9, and
the Evidence-to-Recommendation gate.

**Pilot result:** PASS after revision.

------------------------------------------------------------------------

## Pilot C — Paid Advertising / Growth

**Archetype:** Operating + Decision + Execution + Discovery  
**Rigor:** R2 by default; R3 for material spend, regulated categories,
sensitive data, or high financial exposure.  
**Volatility:** FAST.

### Mini-playbook architecture produced by the standard

1.  Business objective and economic guardrails
2.  Measurement/source-of-truth foundation
3.  Conversion definitions and data quality
4.  Account/campaign architecture
5.  Audience/query/creative strategy
6.  Bidding and budget decision logic
7.  Experiment design
8.  Learning/ramp-up and conversion-delay rules
9.  Performance diagnosis
10. Scaling/constraint decisions
11. Privacy/policy controls
12. Change monitoring and platform-freshness triggers
13. Plays/runbooks by campaign objective

### Sample Play tested — Evaluate a material bidding change

The standard correctly forced: - current official platform source; -
objective-aligned metric; - conversion tracking verification; -
control/treatment logic; - one material variable at a time; -
ramp-up/learning period; - conversion-delay handling; - budget
constraints; - predeclared evaluation criteria; - no premature
optimization; - decision record and revisit trigger.

Current Google Ads guidance explicitly recommends objective-based setup,
accurate conversion data, controlled experiments, allowance for
learning/conversion cycles, and evaluation on relevant goal metrics. It
also demonstrates why this domain needs fast freshness checks: Google
changed Smart Bidding naming in June 2026 and is upgrading a broad-match
campaign setting toward AI Max from September 2026. The master
standard’s volatility and event-triggered review model handled this
correctly. \[S46\] \[S47\] \[S48\]

### Defects found

No architecture break after the sanity-audit revisions. RC1 already had
strong volatility/freshness logic, but RC2’s source-status discipline
and Evidence-to-Recommendation gate improved the handling of platform
changes, spend risk, and implementation constraints.

**Pilot result:** PASS.

------------------------------------------------------------------------

## 49.4 Cross-pilot conclusions

The three pilots exercise materially different failure modes:

| Domain                              | Dominant uncertainty                     | What would break a weak master standard?                 | RC2 result |
|-------------------------------------|------------------------------------------|----------------------------------------------------------|------------|
| Software / AI engineering           | technical/system risk                    | insufficient controls, testing, provenance, recovery     | PASS       |
| Market validation / business design | epistemic/market uncertainty             | false linearity, arbitrary thresholds, confirmation bias | PASS       |
| Paid advertising / growth           | platform volatility + causal measurement | stale tactics, weak measurement, premature conclusions   | PASS       |

No pilot required abandoning the artifact hierarchy or six-archetype
model.

The pilots **did** require strengthening cross-cutting controls
around: - evidence → recommendation; - applicability/implementation; -
stakeholder evidence; - editorial independence/conflicts; - human
factors/accessibility; - AI/agent execution and monitoring.

### Remaining gate before `v1.0 VALIDATED`

This document SHOULD NOT yet be labeled `VALIDATED`.

Remaining requirements: 1. named accountable owner; 2. at least one
representative non-author human execution/field test in each of the
three pilot domains; 3. independent expert challenge of at least one
R3/R4 application; 4. closure or explicit acceptance of defects from
those tests; 5. regression check after resulting changes.

Brand Positioning remains a useful **fourth future regression domain**
because it is evidence-informed but highly judgment-heavy.

------------------------------------------------------------------------

# 50. Source register and annotated evidence review

> **Important:** Sources below have different evidentiary roles.
> Inclusion does not imply equal weight. Primary/official sources are
> preferred for claims about their own standards or systems. Consultancy
> and vendor frameworks are treated as applied evidence and heuristics
> unless independently corroborated. The register also records
> materially reviewed sources that may not be cited in the final
> normative text.

## S01 — ISO 9001:2026 — Quality management systems — Requirements

**Institution:** International Organization for Standardization  
**Status at cutoff:** Published; current edition released 2026-09-16.  
**Used for:** quality-management system logic, context, planning,
operation, performance evaluation, continual improvement,
risk/opportunity thinking.  
**Strength:** international consensus standard; current.  
**Limitation:** full copyrighted standard was not reproduced; this
standard uses publicly available ISO descriptions and principles.  
**URL:** https://www.iso.org/standard/9001

## S02 — ISO 10013:2021 — Guidance for documented information

**Institution:** ISO  
**Used for:** tailoring documented information, development/maintenance,
preserving organizational knowledge, digital documentation, no mandatory
one-size-fits-all hierarchy.  
**Strength:** directly relevant published guidance on documented
information.  
**Current-status note:** under systematic review in 2026, but remains
published at this cutoff.  
**URL:** https://www.iso.org/standard/75736.html

## S03 — ISO 30401:2018 — Knowledge management systems — Requirements

**Institution:** ISO  
**Used for:** establishing, maintaining, reviewing, and improving
organizational knowledge-management systems.  
**Strength:** direct knowledge-management standard.  
**Current-status note:** published edition remains in force but is
marked for revision.  
**URL:** https://www.iso.org/standard/68683.html

## S04 — ISO/DIS 30401 — Knowledge management systems — Requirements, draft revision

**Institution:** ISO  
**Status:** Draft International Standard, under development as of
2026-09-27.  
**Use:** watchlist only; confirms active revision of the
knowledge-management standard.  
**Rule:** MUST NOT be represented as the final current standard.  
**URL:** https://www.iso.org/standard/89436.html

## S05 — NIST AI RMF Playbook

**Institution:** U.S. National Institute of Standards and Technology  
**Used for:** modular playbook philosophy, tailored suggested actions,
living-resource concept.  
**Key relevance:** NIST explicitly says the Playbook is not a checklist
or sequence to be followed in full.  
**Current-status note:** AI RMF 1.0 is being revised; the Playbook is
expected to be updated afterward.  
**URL:** https://airc.nist.gov/airmf-resources/playbook/

## S06 — NIST AI RMF Playbook FAQs

**Institution:** NIST  
**Used for:** explicit rejection of one-size-fits-all and ordered-list
assumptions; repurposing of relevant portions.  
**URL:** https://airc.nist.gov/airmf-resources/playbook/faq/

## S07 — NIST SP 800-61 Rev. 3 — Incident Response Recommendations and Considerations for Cybersecurity Risk Management

**Institution:** NIST  
**Used for:** integrating response into broader risk management,
preparation, response, recovery, learning.  
**Published:** 2025.  
**URL:** https://csrc.nist.gov/pubs/sp/800/61/r3/final

## S08 — RFC 8174 / BCP 14 — Requirement keywords

**Institution:** IETF / RFC Editor  
**Used for:** disciplined use of uppercase normative terms such as MUST,
SHOULD, MAY.  
**Limitation:** this house standard borrows the clarity convention; it
is not an IETF specification.  
**URL:** https://www.rfc-editor.org/info/rfc8174/

## S09 — AWS Well-Architected: Use runbooks to perform procedures

**Institution:** Amazon Web Services  
**Used for:** known-path runbook definition, desired outcome,
tools/permissions, error handling, exceptions, escalation, ownership,
central version-controlled publication, second-person validation,
automation.  
**Strength:** mature operational engineering guidance.  
**Limitation:** cloud-operations context; generalized only where
appropriate.  
**URL:**
https://docs.aws.amazon.com/wellarchitected/latest/framework/ops_ready_to_support_use_runbooks.html

## S10 — AWS Well-Architected: Use playbooks to investigate issues

**Institution:** AWS  
**Used for:** distinction between investigative playbooks and runbooks,
operational testing, repeatability, escalation.  
**URL:**
https://docs.aws.amazon.com/wellarchitected/latest/framework/ops_ready_to_support_use_playbooks.html

## S11 — Microsoft Azure Well-Architected: Standardizing operations

**Institution:** Microsoft  
**Used for:** standardization without excessive rigidity, actionable
procedures, living documentation, versioning, ownership, review dates,
regular review.  
**URL:**
https://learn.microsoft.com/en-us/azure/well-architected/operational-excellence/formalize-operations-tasks

## S12 — Google SRE: Managing Incidents

**Institution:** Google  
**Used for:** planning before incidents, role clarity, incident
artifacts, handoffs, triggers, practice/rehearsal.  
**URL:** https://sre.google/sre-book/managing-incidents/

## S13 — Google SRE: Postmortem Culture

**Institution:** Google  
**Used for:** learning from failures, specific and trackable actions,
avoiding vague remediation, system improvement.  
**URL:** https://sre.google/sre-book/postmortem-culture/

## S14 — NASA Systems Engineering Handbook

**Institution:** NASA  
**Used for:** input/activity/output thinking, verification vs
validation, decision analysis, criteria and alternatives, uncertainty,
risk, proportional rigor, reviews, traceability.  
**Strength:** high-reliability systems-engineering practice.  
**Limitation:** designed for engineering/mission contexts; controls must
be scaled appropriately for ordinary business work.  
**URL:** https://www.nasa.gov/reference/systems-engineering-handbook/

## S15 — CISA Federal Government Cybersecurity Incident and Vulnerability Response Playbooks

**Institution:** U.S. Cybersecurity and Infrastructure Security Agency  
**Used for:** standardized response procedures, phases, coordination,
tracking, companion checklists.  
**Limitation:** federal cybersecurity context.  
**URL:**
https://www.cisa.gov/sites/default/files/publications/Federal_Government_Cybersecurity_Incident_and_Vulnerability_Response_Playbooks_508C_1.pdf

## S16 — Center for Evidence-Based Management — Evidence-Based Practice / Decision Making

**Institution:** CEBMa  
**Used for:** critical thinking + best available evidence, multi-source
evidence, Ask–Acquire–Appraise–Aggregate–Apply–Assess sequence,
rejection of fad/authority-only reasoning.  
**URLs:**  
-
https://cebma.org/assets/Uploads/Evidence-Based-Practice-The-Basic-Principles.pdf  
-
https://cebma.org/resources/cebmas-e-textbook-evidence-based-decision-making-for-organizations-public-policy-and-practice

## S17 — PRISMA 2020

**Institution:** PRISMA Executive / research community  
**Used for:** transparency in evidence-review reporting, explicit
method, checklist/flow concepts.  
**Limitation:** primarily a reporting guideline for systematic reviews;
this master standard only adapts relevant transparency principles.  
**URL:** https://www.prisma-statement.org/prisma-2020

## S18 — PRISMA-S

**Institution:** PRISMA  
**Used for:** traceability and reporting of literature-search methods
when deep research rigor warrants it.  
**URL:** https://www.prisma-statement.org/prisma-search

## S19 — Stanford d.school — Design Abilities

**Institution:** Stanford University d.school  
**Used for:** navigating ambiguity, learning from people/context,
synthesis, rapid experimentation, deliberate construction, designing the
design process itself.  
**URL:** https://dschool.stanford.edu/tools/design-abilities-workshop

## S20 — Stanford d.school — “Let’s Stop Talking About THE Design Process”

**Institution:** Stanford d.school  
**Used for:** rejection of rigid single-process thinking in ambiguous
design work; selection of methods for project/learning context.  
**URL:**
https://dschool.stanford.edu/stories/lets-stop-talking-about-the-design-process

## S21 — Stanford d.school — Design Project Scoping Guide / Experiment Expedition

**Institution:** Stanford d.school  
**Used for:** project framing, choosing design techniques based on need,
iteration, prototypes, capturing data, learning through experiments.  
**URLs:**  
- https://dschool.stanford.edu/tools/design-project-scoping-guide  
- https://dschool.stanford.edu/tools/experiment-expedition

## S22 — Harvard Business Review — Building a Learning Organization

**Author:** David A. Garvin, Harvard Business School  
**Used for:** systematic problem-solving, experimentation, learning from
experience and others, knowledge transfer, and measurement of
learning.  
**Limitation:** foundational applied academic/management source rather
than a formal standard; published in 1993, so used for durable
learning-system principles rather than current technology practice.  
**URL:** https://hbr.org/1993/07/building-a-learning-organization

## S23 — McKinsey — A new operating model for a new world

**Institution:** McKinsey & Company  
**Published:** 2025  
**Used for:** operating-model integration across purpose, governance,
process, technology, skills, behavior, leadership and related elements;
clarity/speed/capability.  
**Evidence role:** applied consultancy research, not normative
authority.  
**URL:**
https://www.mckinsey.com/capabilities/people-and-organization/our-insights/a-new-operating-model-for-a-new-world

## S24 — McKinsey — Capability building / institutional capabilities

**Institution:** McKinsey & Company  
**Used for:** capability as more than documentation—people, processes,
technology, roles, routines, practice.  
**Evidence role:** applied practitioner framework.  
**URL:**
https://www.mckinsey.com/capabilities/people-and-organization/our-insights/building-agile-capabilities-the-fuel-to-power-your-agile-body

## S25 — Bain & Company — RAPID / Five Steps to Better Decisions

**Institution:** Bain & Company  
**Used for:** explicit decision roles and decision process clarity.  
**Evidence role:** applied proprietary framework; optional, not
universal.  
**URL:**
https://media.bain.com/Images/BAIN_BRIEF_Decision_Insights_The_five_steps_to_better_decisions.pdf

## S26 — BCG — Operating-system / continuous-improvement research

**Institution:** Boston Consulting Group  
**Used for:** applied view that operating systems combine principles,
rules, practices and tools and should improve through learning.  
**Evidence role:** secondary/applied.  
**URL:**
https://www.bcg.com/publications/2025/change-behaviors-to-transform-manufacturing-operations

## S27 — Atlassian Team Playbook

**Institution:** Atlassian  
**Used for:** tactical Play design, prep, instructions, outcomes,
optional templates, no universal ordering, repeated use.  
**Evidence role:** applied product/organizational practice with internal
research support.  
**URL:** https://www.atlassian.com/team-playbook

## S28 — Strategyzer — Testing business ideas / hypotheses

**Institution:** Strategyzer  
**Used for:** Discovery-Play logic—testable hypotheses, critical
assumptions, experiments, evidence strength, learning.  
**Evidence role:** specialized practitioner methodology; not universal
outside discovery/innovation.  
**URL:** https://www.strategyzer.com/library

## S29 — Lean Enterprise Institute — Standardized Work

**Institution:** Lean Enterprise Institute  
**Used for:** standard work as a baseline for stability, training,
reduced variation, and continuous improvement.  
**Evidence role:** mature practitioner tradition.  
**URL:** https://www.lean.org/lexicon-terms/standardized-work/

## S30 — Knowledge at Wharton — Decision-Driven Analytics

**Institution:** Wharton School, University of Pennsylvania  
**Used for:** framing the decision and questions before selecting data;
feasible alternatives; uncertainty and judgment.  
**Evidence role:** academic/practitioner synthesis.  
**URLs:**  
-
https://knowledge.wharton.upenn.edu/article/four-pillars-of-decision-driven-analytics/  
-
https://knowledge.wharton.upenn.edu/article/better-decisions-with-data-asking-the-right-question/

## S31 — Knowledge at Wharton — Autonomy and decision boundaries

**Institution:** Wharton School Press / Knowledge at Wharton  
**Used for:** explicit boundaries around which decisions people may make
independently, make-and-inform, or may not make.  
**Evidence role:** practical leadership guidance.  
**URL:**
https://knowledge.wharton.upenn.edu/article/why-employees-need-autonomy/

## S32 — ISO 31000:2018 — Risk management — Guidelines

**Institution:** ISO  
**Status at cutoff:** Published/current; reviewed and confirmed in 2023,
with Edition 3 under development.  
**Used for:** risk-based tailoring, context, integration,
monitoring/review, human and cultural factors.  
**URL:** https://www.iso.org/standard/65694.html

## S33 — FAA Human Factors Design Standard (HF-STD-001B)

**Institution:** U.S. Federal Aviation Administration  
**Published:** 2016  
**Used for:** treating human factors as integral to safety/effectiveness
and requiring professional judgment in applying standards.  
**Limitation:** aviation/safety context; generalized only at the
principle level.  
**URL:**
https://hf.tc.faa.gov/publications/2016-12-human-factors-design-standard/

## S34 — WHO Surgical Safety Checklist Implementation Manual

**Institution:** World Health Organization  
**Used for:** checklist brevity, critical-item protection, local
adaptation, staff engagement, training, champions, coaching, feedback,
and phased implementation.  
**Limitation:** clinical/surgical context; used for
checklist/implementation design principles, not clinical content.  
**URL:**
https://iris.who.int/bitstream/handle/10665/44186/9789241598590_eng.pdf

## S35 — NICE — Developing NICE guidelines: the manual

**Institution:** National Institute for Health and Care Excellence  
**Used for:** protocol-first evidence review, outcome prioritization
before results, recommendation clarity, stakeholder/committee
governance, conflict management.  
**Limitation:** health-guideline context; adapted only where
decision-quality logic is transferable.  
**URLs:**  
- https://www.nice.org.uk/process/pmg20/chapter/reviewing-evidence/  
-
https://www.nice.org.uk/process/pmg20/chapter/decision-making-committees

## S36 — Cochrane Handbook — GRADE / certainty of evidence

**Institution:** Cochrane  
**Used for:** certainty-of-evidence appraisal, including risk of bias,
inconsistency, indirectness, imprecision, publication bias, transparent
justification, and independent assessment.  
**Limitation:** designed for evidence synthesis in health research; not
imported wholesale into ordinary business evidence.  
**URL:**
https://www.cochrane.org/authors/handbooks-and-manuals/handbook/current/chapter-14

## S37 — GRADE Working Group — Evidence to Decision

**Institution:** GRADE Working Group  
**Used for:** separating evidence certainty from recommendation/decision
strength and considering contextual criteria such as feasibility,
acceptability, resources/cost, values, and equity.  
**Limitation:** health-guideline origin; this standard uses an adapted
cross-domain gate.  
**URLs:**  
- https://www.gradeworkinggroup.org/  
- https://book.gradepro.org/guideline/overview-of-the-grade-approach

## S38 — AGREE II — Appraisal of Guidelines for Research & Evaluation

**Institution:** AGREE Research Trust / international
guideline-development research community  
**Used for:** scope/purpose, stakeholder involvement, rigor of
development, clarity, applicability, external review/update logic,
editorial independence and conflict-of-interest controls.  
**Limitation:** clinical-practice-guideline appraisal instrument; used
here as a strong analogue for guidance quality.  
**URL:**
https://www.agreetrust.org/wp-content/uploads/2013/10/AGREE-II-Users-Manual-and-23-item-Instrument_2009_UPDATE_2013.pdf

## S39 — APQC Process Classification Framework guidance

**Institution:** APQC  
**Used for:** common process language, hierarchical process
decomposition, definitions, anticipated outcomes, measures, and
adaptation to organizational context.  
**Evidence role:** mature process-management framework, not a normative
international standard.  
**URL:**
https://www.apqc.org/resource-library/resource-listing/creating-process-definitions-how-use-process-classification

## S40 — W3C WAI — Clear and understandable content / step-by-step instructions

**Institution:** World Wide Web Consortium, Web Accessibility
Initiative  
**Used for:** clear words, short structured content, descriptive
headings, separated instructions, understandable language,
accessibility-oriented content design.  
**URLs:**  
-
https://www.w3.org/WAI/WCAG2/supplemental/objectives/o3-clear-content/  
-
https://www.w3.org/WAI/WCAG2/supplemental/patterns/o4p07-step-instructions/  
- https://www.w3.org/TR/wcag/

## S41 — NIST AI 600-1 — Generative AI Profile

**Institution:** NIST  
**Published:** 2024; NIST page updated 2026  
**Used for:** AI TEVV, governance/oversight, provenance, adversarial
testing, structured feedback, risk-based controls.  
**URL:**
https://www.nist.gov/publications/artificial-intelligence-risk-management-framework-generative-artificial-intelligence

## S42 — NIST 2026 — Challenges to the Monitoring of Deployed AI Systems

**Institution:** NIST Center for AI Standards and Innovation  
**Published:** 2026-03-06  
**Used for:** post-deployment monitoring, real-world validation,
non-determinism/dynamic inputs, unforeseen consequences.  
**URL:**
https://www.nist.gov/publications/challenges-monitoring-deployed-ai-systems-center-ai-standards-and-innovation

## S43 — OWASP AI Agent Security Cheat Sheet

**Institution:** OWASP GenAI Security Project  
**Used for:** applied agent-security patterns including least privilege,
explicit authorization for sensitive tools, high-impact action controls,
structured outputs, bounded retries/tool chains, monitoring, and
adversarial testing.  
**Evidence role:** applied security guidance; fast-moving and SHOULD be
rechecked frequently.  
**URL:**
https://cheatsheetseries.owasp.org/cheatsheets/AI_Agent_Security_Cheat_Sheet.html

## S44 — NIST SP 800-218 — Secure Software Development Framework

**Institution:** NIST  
**Current normative baseline at cutoff:** SP 800-218 / SSDF 1.1 final
(2022).  
**Watch item:** SP 800-218 Rev. 1 / SSDF 1.2 was an Initial Public Draft
at the cutoff and MUST NOT be represented as final.  
**Used for:** software/AI engineering pilot, outcome-based
secure-development practices, risk/resource tailoring.  
**URLs:**  
- https://csrc.nist.gov/pubs/sp/800/218/final  
- https://csrc.nist.gov/pubs/sp/800/218/r1/ipd

## S45 — SLSA v1.2

**Institution:** OpenSSF / SLSA community specification  
**Status at cutoff:** Version 1.2 approved/current.  
**Used for:** software supply-chain provenance, Build and Source tracks,
verification and increasing security guarantees.  
**URL:** https://slsa.dev/spec/v1.2/

## S46 — Google Ads Help — Finding success with Smart Bidding / account setup

**Institution:** Google  
**Status at cutoff:** Current official platform documentation.  
**Used for:** paid-advertising pilot; objective-based campaign setup,
accurate conversion data, goal-aligned bidding, experimentation.  
**URLs:**  
- https://support.google.com/google-ads/answer/6167140  
- https://support.google.com/google-ads/answer/6167145

## S47 — Google Ads Help — Smart Bidding performance and exploration experiments

**Institution:** Google  
**Status at cutoff:** Current official platform documentation.  
**Used for:** paid-advertising pilot; conversion-delay/learning
considerations, relevant metrics, experiment isolation, ramp-up and
duration.  
**URLs:**  
- https://support.google.com/google-ads/answer/6268633  
- https://support.google.com/google-ads/answer/16294686

## S48 — Google Ads Help — 2026 bidding and broad-match/AI Max changes

**Institution:** Google  
**Status at cutoff:** Current official platform documentation, including
2026 product changes.  
**Used for:** demonstrating why fast-changing playbooks require source
freshness and event-triggered review.  
**URLs:**  
- https://support.google.com/google-ads/answer/14571185  
- https://support.google.com/google-ads/answer/13389795

## S49 — ISO 19011:2026 — Guidelines for auditing management systems

**Institution:** International Organization for Standardization  
**Status:** Published; current edition, May 2026.  
**Used for:** audit-program logic, audit principles, evidence-based and
risk-based auditing, reviewer/auditor competence, independence and
follow-up.  
**Strength:** current international consensus guidance for
management-system auditing.  
**Limitation:** not a playbook-specific audit standard; V2 adapts the
general assurance principles.  
**URL:** https://www.iso.org/standard/19011

## S50 — UK Magenta Book 2026 — Central Government guidance on evaluation

**Institution:** HM Treasury / Evaluation Task Force, UK Government  
**Status:** Updated May 2026.  
**Used for:** Theory of Change, process/impact/value evaluation,
evaluation planning before implementation, proportionality, alternative
explanations, triangulation, unintended outcomes, decision-linked
evidence.  
**Strength:** current, detailed cross-government evaluation methodology
with external peer review.  
**Limitation:** public-policy context; specific analytical methods
require domain adaptation.  
**URL:**
https://www.gov.uk/government/publications/the-magenta-book/magenta-book-central-government-guidance-on-evaluation-html

## S51 — Updated Consolidated Framework for Implementation Research (CFIR)

**Source:** Damschroder et al., *Implementation Science* 17, 75 (2022)
and CFIR Guide.  
**Used for:** implementation determinants across innovation, outer
setting, inner setting, individuals, and implementation process;
context/adaptation.  
**Strength:** widely used implementation framework updated through
literature review and experienced-user feedback.  
**Limitation:** developed primarily in health services; V2 uses its
determinant logic as a cross-domain prompt rather than a universal
mandatory taxonomy.  
**URLs:**  
- https://doi.org/10.1186/s13012-022-01245-0  
- https://cfirguide.org/

## S52 — RE-AIM / PRISM

**Institution:** RE-AIM / PRISM framework community  
**Used for:** separating reach, effectiveness, adoption, implementation,
and maintenance; planning for external validity and sustainment.  
**Strength:** mature implementation/evaluation framework used across
many real-world intervention settings.  
**Limitation:** public-health origins; exact measures are contextual
outside that domain.  
**URL:** https://re-aim.org/learn/what-is-re-aim/

## S53 — Proctor et al. — Implementation outcomes taxonomy

**Source:** Proctor E. et al., *Administration and Policy in Mental
Health* (2011), “Outcomes for implementation research: conceptual
distinctions, measurement challenges, and research agenda.”  
**Used for:** acceptability, adoption, appropriateness, feasibility,
fidelity, implementation cost, penetration, and sustainability as
implementation outcomes distinct from service/client outcomes.  
**Limitation:** health-services origin; V2 adapts the distinction, not a
health-specific measurement mandate.  
**URL:** https://doi.org/10.1007/s10488-010-0319-7

## S54 — UK HSE — Procedures and human factors guidance

**Institution:** Health and Safety Executive  
**Used for:** fit-for-purpose procedures, procedure usability, task
analysis, operator involvement, competence, and the warning that
procedures are not a standalone defence against human error.  
**Strength:** mature safety/human-factors guidance grounded in
high-consequence operations.  
**Limitation:** safety-critical industrial context; depth must be
proportionate in ordinary business processes.  
**URL:** https://www.hse.gov.uk/humanfactors/topics/procedures.htm

## S55 — NASA — Human-centered task analysis / systems engineering processes

**Institution:** National Aeronautics and Space Administration  
**Used for:** human-centered task analysis, early user involvement,
prototyping, human-in-the-loop testing, task decomposition, information
requirements, training/procedure design, nominal and contingency
conditions.  
**Strength:** high-reliability systems-engineering practice.  
**Limitation:** spaceflight/safety context; controls must be scaled to
business risk.  
**URL:**
https://www.nasa.gov/reference/3-0-systems-engineering-processes-vol-2/

## S56 — National Academies — Standards for Developing Trustworthy Guidelines

**Institution:** National Academies / Institute of Medicine  
**Used for:** transparency, conflict-of-interest management,
multidisciplinary development, systematic evidence review, explicit
recommendation reasoning, external review, updating.  
**Strength:** influential consensus standard for trustworthy guideline
development.  
**Limitation:** clinical-practice-guideline context; V2 uses only
transferable governance/quality mechanisms.  
**URL:** https://www.ncbi.nlm.nih.gov/books/NBK209539/

## S57 — PRISMA-S — Reporting literature searches in systematic reviews

**Source:** Rethlefsen et al., *Systematic Reviews* 10, 39 (2021)  
**Used for:** transparent, reproducible reporting of literature
searches, including databases/platforms, search strategies, web
searching, and search records.  
**Strength:** international consensus reporting extension developed
through Delphi, consensus conference, and public review.  
**Limitation:** reporting guidance; does not itself guarantee that a
search is methodologically adequate.  
**URL:** https://doi.org/10.1186/s13643-020-01542-z

## S58 — Cochrane Handbook — Searching for and selecting studies

**Institution:** Cochrane  
**Status:** Current handbook chapter last updated March 2025.  
**Used for:** systematic/comprehensive study identification, search
planning, selection, documentation, duplicate-report handling,
information-specialist involvement.  
**Strength:** mature evidence-synthesis methodology.  
**Limitation:** intervention-review context; full Cochrane methods are
not required for ordinary business research.  
**URL:**
https://www.cochrane.org/authors/handbooks-and-manuals/handbook/current/chapter-04

## S59 — PRESS 2015 — Peer Review of Electronic Search Strategies

**Source:** McGowan et al., *Journal of Clinical Epidemiology* 75
(2016)  
**Used for:** peer review of complex search strategies and prevention of
retrieval errors.  
**Strength:** evidence-based guideline developed using systematic
review, expert survey, and consensus.  
**Limitation:** bibliographic database searching; use only when search
omission risk warrants specialist review.  
**URL:** https://pubmed.ncbi.nlm.nih.gov/27005575/

## S60 — JBI Manual for Evidence Synthesis

**Institution:** JBI  
**Used for:** explicit selection among multiple evidence-synthesis
methodologies, including effectiveness, qualitative, textual, economic,
mixed methods, umbrella, and scoping reviews;
feasibility/appropriateness/ meaningfulness/effectiveness framing.  
**Strength:** mature pluralistic evidence-synthesis methodology.  
**Limitation:** health/evidence-synthesis context; method routing is
adapted rather than imported wholesale.  
**URL:**
https://jbi-global.atlassian.net/wiki/spaces/MANUAL/pages/355598392

## S61 — ISO/IEC 25010:2023 — Product quality model

**Institution:** ISO/IEC JTC 1/SC 7  
**Status:** Published; current edition.  
**Used for:** optional quality-requirement and acceptance-criteria
reference when software/ICT products are required for playbook
execution.  
**Strength:** international product-quality reference model.  
**Limitation:** software/ICT-specific; not a universal playbook quality
model.  
**URL:** https://www.iso.org/standard/78176.html

## S62 — NIST AI 200-3 — ARIA Evaluation Planning Manual

**Institution:** NIST Center for AI Standards and Innovation  
**Status:** Published September 18, 2026.  
**Used for:** holistic AI evaluation combining model testing, red
teaming, and user testing; planning customized evaluation evidence.  
**Strength:** current NIST AI-evaluation guidance.  
**Limitation:** AI-specific and newly published; implementation practice
will continue to evolve.  
**URL:**
https://www.nist.gov/publications/aria-evaluation-planning-manual-elements-aria-style-ai-evaluations

## S63 — NIST AI 200-2 IPD — TEVV-Athlon Framework

**Institution:** NIST  
**Status:** Initial Public Draft announced August 7, 2026; comment
period open through October 6, 2026 at this evidence cutoff.  
**Used for:** watchlist/emerging model for context-specific TEVV across
ML, LLMs, multimodal and agentic systems.  
**Rule:** MUST NOT be represented as a final normative standard.  
**URL:**
https://www.nist.gov/artificial-intelligence/ai-research/tevv-athlon-framework-evaluating-ai-systems

## S64 — ISO 10010:2022 — Organizational quality culture

**Institution:** ISO  
**Status:** Published.  
**Used for:** leadership, people engagement, assessment and improvement
of quality culture where sustained behavior is a dependency of playbook
success.  
**Strength:** international guidance.  
**Limitation:** culture is contextual and cannot be reduced to a
documentation control.  
**URL:** https://www.iso.org/standard/38457.html

## S65 — NICE — Updating guideline recommendations / surveillance

**Institution:** National Institute for Health and Care Excellence  
**Status:** Guideline manual updated October 2025; current at evidence
cutoff.  
**Used for:** distinguishing full/partial update from usability refresh,
auditability of update records, event-driven surveillance, stakeholder
notification/consultation, and withdrawal/replacement logic.  
**Strength:** mature living-guideline lifecycle practice.  
**Limitation:** health-guideline context; V2 adapts the lifecycle
mechanisms.  
**URLs:**  
-
https://www.nice.org.uk/process/pmg20/chapter/updating-guideline-recommendations  
-
https://www.nice.org.uk/process/pmg20/chapter/ensuring-that-published-guidelines-are-current-and-accurate/

## S66 — NASA Lessons Learned Lifecycle

**Institution:** NASA APPEL Knowledge Services  
**Used for:** collect → record → disseminate → apply lifecycle and
explicit integration of lessons into processes, checklists, handbooks,
training, and policy.  
**Strength:** mature learning-system practice in a high-reliability
organization.  
**Limitation:** organizational implementation details are
NASA-specific.  
**URL:**
https://www.nasa.gov/learning-resources/for-professionals/appel-lessons-learned/

## S67 — APQC Knowledge Flow

**Institution:** APQC  
**Used for:** create, identify, collect, review, share, access, and use
as a knowledge-flow lifecycle; business alignment and measurement of
knowledge reuse.  
**Strength:** mature applied knowledge-management research and
benchmarking.  
**Limitation:** practitioner/benchmark source rather than binding
standard.  
**URL:**
https://www.apqc.org/blog/managing-knowledge-starts-knowledge-flow

------------------------------------------------------------------------

# 51. Source-selection conclusions

The research review does **not** support a simplistic hierarchy such as:

> university \> consultancy \> practitioner.

The more defensible rule is:

> **Choose the source type that has the strongest authority, method,
> directness, recency, and context fit for the claim; then triangulate
> important decisions across independent evidence where practical.**

Examples:

- For a Google Ads setting, Google’s current official documentation may
  be the authoritative source.
- For whether feedback improves human performance, a strong research
  synthesis may be superior.
- For whether *our* onboarding process works, internal data can be
  indispensable.
- For an unusual implementation edge case, experienced practitioners may
  discover issues no paper covers.
- For stakeholder preferences, asking the stakeholders is often
  necessary.
- For law, the law and competent legal interpretation outrank a
  consultant’s blog.
- For a recommendation, evidence certainty is only one input;
  feasibility, harms, resources, stakeholder values, acceptability,
  accessibility/equity, and implementation can change the action.
- For AI/agent execution, current risk/monitoring sources must be
  rechecked frequently because controls and terminology are evolving.

This is a core standard.

------------------------------------------------------------------------

# 52. Watchlist

The following sources are likely to require near-term review.

## ISO 30401 revision

ISO 30401:2018 remains published but is scheduled to be replaced;
ISO/DIS 30401 is under development as of 2026-09-27. \[S03\] \[S04\]

**Trigger:** update this standard when the new edition is published.

## NIST AI RMF revision

NIST states that AI RMF 1.0 is being updated and the Playbook will be
updated afterward. \[S05\]

**Trigger:** re-check NIST-specific playbook design implications after
publication.

## ISO 31000 revision

ISO 31000:2018 remains the current published edition at this cutoff;
Edition 3 is under development. \[S32\]

**Trigger:** review the risk/rigor model when the new edition is
published.

## NIST SSDF revision

SP 800-218 / SSDF 1.1 remains the current final baseline; SP 800-218
Rev. 1 / SSDF 1.2 was still draft at the cutoff. \[S44\]

**Trigger:** update software-engineering pilot mappings when the
revision becomes final.

## NIST TEVV-Athlon draft

NIST AI 200-2 / TEVV-Athlon is an Initial Public Draft at this cutoff,
with the comment period scheduled to close 2026-10-06. \[S63\]

**Trigger:** re-evaluate V2’s AI-evaluation routing when NIST publishes
a subsequent draft or final publication.

## Fast-moving AI-agent execution patterns

The human+AI execution section is intentionally labeled `HOUSE` because
tooling, agent protocols, and control patterns are evolving rapidly.

**Trigger:** quarterly review plus significant platform/security
changes.

------------------------------------------------------------------------

# 53. Compact release checklist

Before publishing any playbook:

### Purpose

- [ ] Outcome defined
- [ ] Users defined
- [ ] Scope defined
- [ ] Archetype selected
- [ ] Rigor level selected

### Evidence

- [ ] Authorities checked
- [ ] Question/review design fits the evidence need
- [ ] Sources appraised with method-appropriate controls
- [ ] R3/R4 search provenance reproducible
- [ ] Contradictions searched
- [ ] Context conditions stated
- [ ] Evidence cutoff recorded
- [ ] Evidence certainty separated from recommendation strength
- [ ] Conflicts/incentives handled for R3/R4

### Construction

- [ ] Principles separated from tactics
- [ ] Decisions explicit
- [ ] Plays actionable
- [ ] Runbooks used for known paths
- [ ] Outputs/acceptance criteria clear
- [ ] Failure/escalation included where material
- [ ] Applicability/implementation considered where material
- [ ] Theory of Change/causal assumptions explicit where outcome claims
  require them
- [ ] Competence/task analysis addressed for material procedures
- [ ] Protected invariants vs local adaptation defined where relevant
- [ ] Accessibility/human factors checked for critical instructions
- [ ] Agent/automation controls included where machine execution applies
- [ ] R3/R4 traceability links requirements/evidence/controls/tests

### QA

- [ ] Internal consistency checked
- [ ] Scenario test complete
- [ ] Non-author test complete where applicable
- [ ] No blocker defects
- [ ] Freshness checked
- [ ] Stakeholder/user validation completed where material
- [ ] Implementation pilot completed where rollout risk warrants
- [ ] Outcome/impact evaluation completed or explicitly scoped where
  causal claims matter
- [ ] Independent/domain review completed where rigor requires
- [ ] Agent/adversarial execution tests completed where applicable

### Governance

- [ ] Owner
- [ ] Version
- [ ] Status
- [ ] Change log
- [ ] Review triggers and surveillance disposition logic
- [ ] Canonical location
- [ ] R3/R4 assurance package retained

### Learning

- [ ] Implementation and end-outcome signals distinguished
- [ ] Effectiveness and guardrail signals
- [ ] Continue/iterate/scale/pause/retire decision rules where material
- [ ] Feedback path
- [ ] Improvement mechanism

------------------------------------------------------------------------

# 54. The standard in one page

A trustworthy playbook is built as follows:

``` text
1. DEFINE
   Outcome → users/stakeholders → scope → archetype → risk/rigor

2. DESIGN THE EVIDENCE
   Question type → review/research design → protocol → authorities → search

3. APPRAISE + SYNTHESIZE
   Evidence → uncertainty → contradiction → applicability → recommendation

4. MODEL THE CHANGE
   Causal assumptions → Theory of Change where needed → implementation context

5. ARCHITECT + BUILD
   Principles → decisions → Plays → runbooks → checklists → tools

6. ENABLE IMPLEMENTATION
   Competence → training/support → protected invariants → local adaptation → rollout

7. VERIFY + ASSURE
   Traceability → logic → technical checks → audit evidence → independent challenge

8. VALIDATE + PILOT
   Real users → scenarios → edge cases → implementation outcomes → accessibility

9. EVALUATE
   Process → implementation → outcome/impact → guardrails → value → decision rules

10. RELEASE + OPERATE
    Owner → version → status → canonical location → monitoring → surveillance

11. LEARN + IMPROVE
    Lessons → root cause → update → regression test → communicate → repeat
```

And every important unit should preserve the chain:

> **Outcome → Evidence → Decision → Action → Implementation →
> Verification → Evaluation → Learning**

That is the canonical design logic of this Master Playbook Standard.

------------------------------------------------------------------------

# 55. Change log

## v2.0-RC1 — 2026-09-27

Research-reviewed V2 candidate. Status reset to `REVIEWED` because the
release contains material architecture changes that must be re-piloted
before `TESTED`.

Major changes from v1.0-RC2:

- expanded source base from 48 to 67 annotated sources;
- added ISO 19011:2026 audit/assurance controls;
- added the UK Magenta Book 2026 evaluation and Theory-of-Change layer;
- added implementation-science routing using CFIR, RE-AIM/PRISM, and
  Proctor implementation outcomes;
- separated intervention/play quality, implementation quality, process
  outcomes, and end outcomes;
- added fit-for-question evidence typing and explicit review-design
  selection;
- added PRISMA-S/PRESS-inspired search reproducibility and peer review
  for R3/R4;
- added method-specific critical appraisal and targeted independent
  checking for high-risk evidence syntheses;
- added competence and human-centered task-analysis requirements;
- added protected invariants vs adaptable periphery;
- added a formal R3/R4 traceability and assurance spine;
- added Theory-of-Change, implementation, traceability, and audit
  templates;
- added implementation pilot and outcome/impact evaluation test levels;
- added surveillance dispositions: retain, refresh, partial update, full
  update, withdraw/deprecate, watch;
- expanded measurement into readiness, implementation, execution,
  outcome, guardrail, sustainment, knowledge-health, and learning
  layers;
- added NIST ARIA 2026 multi-method AI evaluation and explicit
  provisional treatment of TEVV-Athlon;
- added quality-culture/incentive considerations using ISO 9001:2026 and
  ISO 10010;
- added new anti-patterns for causal overclaim, framework cargo cult,
  research maximalism, procedure-as-competence, implementation-metric
  substitution, and audit-by-template;
- preserved RC2 pilot results as historical evidence but explicitly
  requires V2 re-testing before promotion to `TESTED`.

## v1.0-RC2 — 2026-09-27

Expanded sanity-audited and cross-domain-tested release candidate.

Major changes from RC1:

- added Evidence-to-Recommendation gate;
- added GRADE/Cochrane/NICE/AGREE-derived evidence, applicability,
  stakeholder, and editorial-independence controls;
- added implementation/adoption standard;
- added human-factors and accessibility requirements;
- strengthened checklist design and local-adaptation rules;
- expanded AI/agent execution controls with side-effect classes,
  pre/postconditions, schema validation,
  retries/idempotency/concurrency, bounded execution, provenance,
  observability, monitoring, and adversarial tests;
- added conflict-of-interest governance;
- added implementation, accessibility, independence, and agent-control
  QA audits;
- expanded research/source-status discipline;
- added new canonical templates;
- completed three cross-domain pilots: software/AI engineering, market
  validation/business design, and paid advertising/growth;
- retained `TESTED` rather than `VALIDATED` status pending
  representative non-author field execution and named ownership;
- refreshed evidence cutoff to 2026-09-27;
- corrected structural section/subsection numbering defects introduced
  in RC1.

## v1.0-RC1 — 2026-09-22

Initial research-backed release candidate.

Major design decisions:

- established modular artifact hierarchy;
- separated Play from Runbook/SOP;
- introduced six Playbook archetypes;
- adopted normative keyword discipline;
- replaced simplistic source ranking with multi-source evidence
  appraisal;
- introduced claim taxonomy and confidence;
- added risk-proportionate rigor levels;
- defined construction lifecycle and quality gates;
- added verification vs validation;
- added non-author testing;
- established governance/versioning/review;
- added human+AI compatibility as an explicitly labeled house standard;
- recorded ISO 30401 and NIST AI RMF revision watch items;
- defined pilot requirements before `v1.0 VALIDATED`.

------------------------------------------------------------------------

## Final note

This standard should not be treated as complete because it is long.

It should be treated as useful only if it makes future playbooks:

- easier to navigate;
- harder to misuse;
- more evidence-grounded;
- more explicit about uncertainty;
- more reliable in execution;
- easier to implement and sustain;
- clearer about competence and adaptation;
- easier to test and independently assure;
- stronger at distinguishing activity, implementation, and real outcome;
- easier to update;
- and measurably better at producing the outcomes they exist to enable.

**The test of a playbook is not whether it looks authoritative. The test
is whether appropriate users can make better decisions and execute more
reliably because it exists—and whether the system learns when reality
proves it wrong.**
