# 18 — AI / ML / LLM Systems Engineering — V2
## Evidence-based production standard for AI systems, machine learning, generative AI, retrieval and model-serving systems

```yaml
document_id: PB-18-AI-ML-LLM
artifact_type: domain_playbook
version: 2.0
status: REVIEWED
created: 2026-09-27
last_updated: 2026-09-27
last_reviewed: 2026-09-27
evidence_cutoff: 2026-09-27
canonical_language: English
owner: unassigned
primary_archetype: Operating + Capability + Decision + Execution + Response
rigor_default: "R3_CONTROLLED for material production; R2_STANDARD permitted for low-consequence production"
volatility: "component-specific; FAST by default for external-model/provider-dependent guidance"
research_design: standards_and_primary-source_evidence_map_plus_targeted_empirical_review
review_cadence: risk-and-volatility-based
next_scheduled_review: 2026-12-27
supersedes: null
inherits:
  - Master Playbook Standard v2.0-RC1
  - Universal Software & AI Engineering Master Playbook v2.0
applies_to:
  - predictive machine learning systems
  - deep learning systems
  - generative AI systems
  - large language model systems
  - retrieval-augmented generation systems
  - multimodal AI systems
  - model routing and cascade systems
  - AI-enabled applications and services
  - model serving and inference platforms
  - AI evaluation and monitoring systems
out_of_scope:
  - agent orchestration depth owned by Playbook 19
  - general software engineering controls already owned by Playbook 00 and specialist software playbooks
  - domain-specific safety certification
  - jurisdiction-specific legal advice
```

> **V2 status note.** This release is the research-reviewed and falsification-audited successor to V1. It incorporates a separate adversarial audit of evaluation, RAG, data, routing, guardrails, security, inference, monitoring, cost, lifecycle, source status, and false-universality risks. Under Playbook 00 it remains `REVIEWED`, not `VALIDATED`, until representative non-author execution and field use demonstrate fitness for intended production contexts.

---

# Executive standard

Production AI is not a model endpoint. It is a socio-technical software system whose behavior emerges from **data, model weights, prompts/configuration, retrieval, tools, policies, infrastructure, users, feedback loops, and changing real-world conditions**.

The production doctrine is:

> **Define the real decision or task → define unacceptable failure → build the minimum adequate AI system → evaluate the whole system with representative evidence → bound probabilistic behavior with deterministic controls where consequence demands it → release observably and reversibly → monitor real behavior → learn, re-evaluate, update, and retire safely.**

A model that scores well on a benchmark can still be a poor production system. A retrieval system can improve factuality while introducing stale, irrelevant, malicious, or privacy-sensitive context. A guardrail can reduce one risk while creating false positives, bypasses, or hidden operational fragility. A cheaper model can increase total cost if it creates more retries, escalations, rework, or customer failure. A larger model can reduce some error classes while increasing latency, cost, dependency risk, and blast radius.

This playbook therefore treats **system-level evidence** as the unit of trust.

---

# 1. Purpose, outcomes and governing principles

## 1.1 Purpose

This playbook defines how to design, build, evaluate, release, operate, secure, monitor, evolve, and retire production AI/ML/LLM systems.

It exists to enable teams to answer five questions continuously:

1. **Should AI be used for this task at all?**
2. **What level of model/system capability is actually required?**
3. **What evidence demonstrates acceptable quality and risk for the intended population and conditions?**
4. **What controls contain failure when the AI is wrong, attacked, unavailable, stale, biased, or too expensive?**
5. **How will the system remain trustworthy when models, data, providers, users, and the world change?**

## 1.2 Outcomes

A conforming production AI capability SHOULD be:

- useful for the intended task and users;
- sufficiently correct for the consequence of error;
- secure and privacy-aware across the full data/model/tool chain;
- measurable and falsifiable;
- observable after release;
- economically sustainable;
- maintainable and version-controlled;
- recoverable when components fail;
- explicit about uncertainty and known limitations;
- reviewable by competent humans;
- auditable enough for its risk class.

## 1.3 Root principles

1. **System before model.** Model quality is one component of production quality.
2. **Outcome before benchmark.** Define the real task and decision before selecting metrics or models.
3. **Risk before autonomy.** Consequence, permissions, reversibility, and blast radius determine assurance.
4. **Evaluation before optimization.** Do not optimize latency, cost, or architecture before defining acceptable behavior.
5. **Representative evidence before headline scores.** Benchmark performance is scouting evidence, not production acceptance.
6. **Deterministic controls around probabilistic components.** Authorization, transaction limits, data boundaries, and other hard controls MUST NOT depend only on model persuasion.
7. **Data is production code in effect.** Training, evaluation, retrieval, and feedback data require provenance, quality, versioning, security, and lifecycle management.
8. **Offline and online evidence are complementary.** Pre-deployment evaluation cannot substitute for deployed monitoring.
9. **Failure must be designed.** Abstention, escalation, fallback, degradation, and recovery are first-class outputs.
10. **No universal best model, architecture, metric, RAG pattern, guardrail, or routing strategy exists.** Context and evidence determine the fit.
11. **Every material AI change is a production change.** Model, prompt, retriever, embedding model, index, policy, tool, routing rule, decoding configuration, or provider version changes can alter behavior.
12. **Lifecycle ownership continues after launch.** AI quality decays when environments, data, requirements, adversaries, providers, and users change.

---

# 2. How to use this playbook

This playbook has four operating layers inherited from Playbook 00:

- **Orientation:** system model, principles, risk posture.
- **Decision:** model/RAG/routing/build-buy architecture logic.
- **Execution:** lifecycle standards, release controls, runbooks, checklists.
- **Assurance and learning:** evals, monitoring, traceability, audit, evidence map, update triggers.

Use **R3 / CONTROLLED** by default for production AI that affects customers, sensitive data, material business processes, or important decisions. Escalate to **R4 / CRITICAL** when safety, severe security/privacy harm, regulated high-impact decisions, irreversible state, large financial exposure, or similarly severe consequences are plausible.

Low-risk prototypes MAY use lighter controls, but MUST be clearly separated from production claims and production data/permissions.

---

# 3. Scope and boundaries

## 3.1 In scope

- supervised and unsupervised ML;
- ranking/recommendation/classification/regression;
- foundation models and LLMs;
- multimodal models;
- hosted and self-hosted inference;
- RAG, search, reranking, grounding and context assembly;
- prompt and system-instruction engineering;
- fine-tuning/adapters/post-training where used;
- model selection, routing, cascades and fallbacks;
- structured output and tool-mediated generation;
- safety filters, guardrails and policy enforcement;
- offline and online evaluation;
- human evaluation and LLM-based evaluation;
- inference performance, latency, capacity and cost;
- observability, drift, incidents and lifecycle updates;
- AI-specific threat models and supply-chain controls.

## 3.2 Delegated to adjacent playbooks

- general architecture → Playbook 02;
- software construction → Playbook 04;
- verification/testing → Playbook 05;
- security → Playbook 06;
- privacy → Playbook 07;
- reliability/SRE → Playbook 08;
- performance/cost → Playbook 09;
- CI/CD/supply chain → Playbook 10;
- data/database/storage → Playbook 12;
- APIs/distributed systems → Playbook 13;
- backend/services → Playbook 15;
- cloud/infrastructure → Playbook 17;
- agentic AI → Playbook 19.

This playbook adds AI-specific constraints and MUST NOT silently weaken inherited controls.

---

# 4. Evidence and claim standard for production AI

## 4.1 Evidence lanes

Use the inherited claim-fit model. In this domain especially, distinguish:

| Evidence lane | Strongest use | Typical trap |
|---|---|---|
| Law / binding requirement | What must be done in scope | Treating legal minimum as technical optimum |
| International/formal standard | Terminology, management/lifecycle/quality baseline | Treating consensus as proof of effectiveness |
| Peer-reviewed / controlled empirical research | Observed effects in studied tasks/populations | Generalizing across models/tasks/versions |
| Government/open risk framework | Risk and control models | Treating awareness lists as certification |
| Mature production evidence | Mechanisms that survived real operation | Cargo-culting scale-specific implementation |
| Official platform/model documentation | Exact supported behavior and limits | Treating vendor claims as independent quality evidence |
| Practitioner pattern | Useful hypothesis | Calling popularity “best practice” |

## 4.2 AI freshness rule

AI claims MUST include enough temporal context to avoid false permanence. Material claims SHOULD record:

- source date;
- model/tool generation;
- task/domain;
- evaluation population;
- benchmark/eval version;
- provider/runtime version when relevant;
- whether the source is final, draft, preview, or experimental.

## 4.3 Benchmark rule

A benchmark establishes evidence about **that benchmark under its protocol**. It does not automatically establish:

- production fitness;
- user value;
- robustness to distribution shift;
- security;
- factual reliability;
- maintainability;
- latency/cost in your infrastructure;
- compatibility with your data and policies;
- safe tool use;
- human acceptance.

## 4.4 Independence rule

The same model/system SHOULD NOT be the sole producer and sole judge of high-consequence output. Use independent evidence where practical: deterministic validation, separate reference systems, humans, diverse models, held-out data, runtime outcomes, or external measurements.

---

# 5. AI system model

A production AI system SHOULD be modeled explicitly as interacting components. ISO/IEC 23053 provides a useful standards-level framework for ML-system components, while this playbook extends the system boundary to retrieval, tools, policy, operations, and human use [ISO-23053].


```text
USER / BUSINESS PROCESS
        ↓
INPUT / CONTEXT / POLICY
        ↓
PREPROCESSING / FEATURE OR CONTEXT ASSEMBLY
        ↓
RETRIEVAL / TOOLS / DATA SOURCES  ↔  TRUST BOUNDARIES
        ↓
MODEL / ROUTER / CASCADE
        ↓
DECODING / POSTPROCESSING / VALIDATION
        ↓
GUARDRAILS / AUTHORIZATION / BUSINESS RULES
        ↓
ACTION / RESPONSE / DECISION SUPPORT
        ↓
TELEMETRY / FEEDBACK / INCIDENTS / LEARNING
```

For every material component record:

```yaml
component:
owner:
version:
purpose:
inputs:
outputs:
trust_boundary:
source_of_truth:
quality_contract:
failure_modes:
security_privacy_classification:
latency_budget:
cost_driver:
observability:
rollback_or_fallback:
review_trigger:
```

---

# 6. AI System Quality Model

AI quality is multidimensional. ISO/IEC 25059:2023 provides an AI-specific SQuaRE quality model, while this playbook combines that reference with production software, data, risk, and lifecycle concerns [ISO-25059]. Do not reduce the result to one universal score.

For each material system ask:

1. **Task effectiveness** — does it achieve the intended user/business task?
2. **Correctness / factual support** — are outputs sufficiently correct or grounded for the use?
3. **Robustness** — does behavior remain acceptable under plausible variation, noise, shift, and perturbation?
4. **Calibration / uncertainty behavior** — are scores, probabilities, abstention, and uncertainty useful for decisions?
5. **Safety / harm control** — are credible harmful outcomes identified and bounded?
6. **Security** — can adversaries manipulate data, context, models, tools, outputs, or resources?
7. **Privacy** — is personal/sensitive data justified and controlled across prompts, models, embeddings, logs, and feedback?
8. **Fairness / slice performance** — are material populations or contexts harmed by systematic performance differences?
9. **Transparency / traceability** — can important behavior, data, versions, sources, and decisions be reconstructed?
10. **Human interaction quality** — can intended users understand, verify, correct, and safely rely on the system?
11. **Reliability / resilience** — does the capability remain useful under dependency failure, overload, and degraded modes?
12. **Performance / latency / capacity** — does it meet workload-specific service requirements?
13. **Economic/resource efficiency** — does value justify inference, data, tooling, review, and operational cost?
14. **Maintainability / evolvability** — can models, data, prompts, policies, and dependencies be changed safely?
15. **Data quality** — are training, evaluation, retrieval, and feedback data fit for purpose?
16. **Controllability / reversibility** — can exposure, permissions, actions, and harmful changes be stopped or recovered?
17. **Impact / compliance** — are broader stakeholder and scoped regulatory impacts addressed where material?

The quality profile MUST be weighted by the actual consequence of failure. A creative drafting assistant and a medical decision system legitimately require different evidence.

---

# 7. Criticality, rigor and assurance model

This playbook uses two inherited dimensions and MUST NOT invent a third overlapping risk taxonomy:

- **System criticality `C0–C4`** from the Universal Software & AI Engineering Master Playbook describes consequence and assurance need.
- **Playbook rigor `R1–R4`** from Playbook 00 describes evidence, review, traceability, testing, and governance depth.

For ordinary low-consequence, read-only production AI, `R2 / STANDARD` MAY be sufficient. For production AI that materially affects customers, sensitive data, revenue, important decisions, or business operations, default to `R3 / CONTROLLED`. Use `R4 / CRITICAL` when severe safety, security, privacy, legal, irreversible-state, or major financial consequences are plausible.

## 7.1 AI consequence dimensions

Assess at least:

- harm if output is wrong;
- harm if output is plausible but unsupported;
- harm if the system refuses, abstains, or becomes unavailable;
- whether output is advisory, human-reviewed, or automatically acted upon;
- financial value and irreversible state at risk;
- sensitive/personal/confidential data exposure;
- model/tool permissions and accessible resources;
- number and vulnerability of affected people;
- reversibility and recoverability of downstream effects;
- detectability before unacceptable consequence;
- dependence on external provider/model behavior;
- adversarial exposure and abuse incentives;
- opacity/interpretability and explanation requirements;
- regulatory/contractual obligations;
- feedback-loop and self-reinforcement risk;
- uncertainty about the deployed population and environment.

## 7.2 System criticality

### C0 — Experimental
Disposable prototype or research environment with no material users, data, or side effects. Basic hygiene and explicit non-production status are still required.

### C1 — Ordinary
Recoverable inconvenience or low-value assistive use. Representative evals, ordinary security/privacy controls, basic telemetry, and a safe fallback are normally sufficient.

### C2 — Material
Customer impact, sensitive data, revenue, important workflow, or meaningful operational dependency. Strong eval suite, controlled rollout, monitoring, incident response, provenance, and change evidence are required.

### C3 — High assurance
Major financial, privacy, security, societal, or consequential automated impact. Stronger independence, adversarial testing, traceability, separation of duties where relevant, explicit abstention/escalation, and stronger field evidence are required.

### C4 — Safety / mission critical
Credible potential for serious injury, loss of life, catastrophic mission loss, or equivalent consequence. Applicable domain safety/certification standards govern and may require hazard analysis, qualified tools, independent V&V, formal methods, or other specialized assurance.

## 7.3 Assurance selection

Use the inherited decision logic:

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

This is a reasoning model, not literal arithmetic.

## 7.4 Evidence margin

For C2+ systems, a point estimate barely above an acceptance threshold is weak assurance when evaluation uncertainty, distribution uncertainty, or model variance is material. Release decisions SHOULD consider an **evidence margin**: how confidently the system satisfies the requirement under realistic variation, not merely whether one measured mean crosses a line.

---

# 8. End-to-End AI System Lifecycle

ISO/IEC 5338:2023 defines AI-system lifecycle processes and explicitly integrates AI-specific work with established system/software lifecycle processes [ISO-5338]. This playbook uses lifecycle stages as responsibilities, not a mandatory waterfall:

```text
INTENT / USE CASE / CONSEQUENCE
→ REQUIREMENTS + ACCEPTANCE CONTRACT
→ DATA / KNOWLEDGE / RIGHTS
→ MODEL / PROVIDER / ARCHITECTURE SELECTION
→ BUILD / TRAIN / CONFIGURE / RETRIEVE / INTEGRATE
→ EVALUATE / RED-TEAM / USER-TEST
→ RELEASE / DEPLOY / EXPOSE GRADUALLY
→ MONITOR / OPERATE / INCIDENT RESPONSE
→ LEARN / RETRAIN / RECONFIGURE / MIGRATE
→ DEPRECATE / RETIRE / DELETE / ARCHIVE
```

## 8.1 Lifecycle invariants

At every material change, be able to answer:

1. What intended behavior changed?
2. Which data/model/prompt/index/tool/policy version changed?
3. What evidence was invalidated by the change?
4. Which critical failure modes can become worse?
5. What must be re-evaluated before exposure?
6. How will production behavior be observed?
7. How can exposure be stopped, reversed, or compensated?
8. What downstream artifacts, users, documentation, and contracts need migration?

## 8.2 Build / buy / acquire / adapt are all lifecycle choices

The lifecycle applies whether the organization trains a model, fine-tunes an open model, acquires a hosted API, buys an AI product, or embeds a third-party AI service. Acquisition does not transfer accountability for the deployed user outcome.

## 8.3 Post-deployment is not “maintenance only”

For probabilistic systems, monitoring and field evidence can change the validity of the original acceptance claim. Production observation therefore feeds back into requirements, eval design, data, model choice, and guardrails; it is part of assurance, not merely operations [NIST-MON].

---

# 9. Golden Production AI Standards — V2

1. Define the real task, users, environment, decision, and unacceptable failure before choosing a model.
2. Decide whether AI is necessary; prefer simpler deterministic or human processes when they satisfy the requirement with lower risk/cost.
3. Treat the full AI system—not the model—as the production unit of quality and assurance.
4. Define acceptance criteria before model selection when practical.
5. Separate capability, quality, safety, latency, cost, privacy, security, and operability metrics.
6. Use benchmark results for scouting; require local representative evaluation for adoption.
7. Version every behavior-affecting component: model, prompt, policy, retriever, embedding model, index, tool, routing rule, decoding configuration, and critical dependency.
8. Keep hard authorization and irreversible-action controls outside the model.
9. Treat external content, retrieval results, documents, tool output, and user-provided files as untrusted inputs.
10. Validate structured model output before using it as data, code, commands, SQL, policy, or tool input.
11. Never interpret model fluency as factuality, confidence, authorization, or correctness.
12. Define what the system should do when uncertain, unsupported, unsafe, unavailable, or outside scope.
13. Prefer explicit abstention/escalation over confident fabrication where the cost of a wrong answer exceeds the cost of no answer.
14. Do not claim “hallucination solved”; define measurable unsupported/incorrect-output risks for the task.
15. Evaluate relevant slices and failure classes, not only aggregate averages.
16. Maintain protected holdout/challenge sets for material systems.
17. Keep evaluation data separate from training/tuning where leakage would invalidate evidence.
18. Treat evaluation-set contamination as an assurance defect.
19. Calibrate automated judges against human/domain judgments for the target task before relying on them materially.
20. Never use one LLM judge score as sole high-consequence acceptance evidence.
21. Combine model testing, adversarial testing, user/human evaluation, integration testing, and production monitoring according to risk.
22. Treat post-deployment monitoring as necessary evidence for material probabilistic systems.
23. Define data provenance, quality, purpose, rights, sensitivity, retention, and deletion for training, evaluation, retrieval, and feedback data.
24. Treat labels as governed data with instructions, ambiguity handling, quality checks, and versioning.
25. Test training-serving and retrieval-serving consistency where mismatches can change behavior.
26. Use temporal, domain, demographic, geographic, and operational slices where relevant to deployment risk.
27. Monitor for distribution change, but do not equate every drift signal with model failure.
28. Do not auto-retrain or auto-promote solely because a drift threshold fired.
29. Validate retraining against a fixed acceptance contract and regression suite.
30. For RAG, evaluate retrieval, context quality, grounding/faithfulness, answer quality, latency, and cost separately and end-to-end.
31. Do not assume retrieval makes an answer factual; retrieved content can be wrong, stale, irrelevant, malicious, or contradictory.
32. Preserve source provenance through retrieval and generation when factual traceability matters.
33. Use authoritative structured tools/data sources for facts or actions when they provide stronger guarantees than free-form generation.
34. Do not assume long context replaces retrieval; evaluate both under representative context position, size, and distractors.
35. Keep retrieval corpora/indexes under explicit ownership, freshness, access, and deletion controls.
36. Treat embeddings/vector stores as potentially sensitive derived data.
37. Choose model size/provider from task evidence and total system constraints, not prestige.
38. Prefer the smallest/cheapest model that meets the verified quality/risk contract when it materially improves economics or latency.
39. Treat model routing and cascades as control systems that require their own evaluation, observability, fallback, and regression testing.
40. Do not assume a router saves cost after retries, fallbacks, errors, and operational overhead.
41. Evaluate fallback-model behavioral differences before production use.
42. Define inference SLOs using end-to-end latency plus relevant component measures, not average latency alone.
43. For generative serving, distinguish queue delay, time-to-first-token, inter-token/decode latency, and total completion time where user experience depends on them.
44. Measure tail latency and load behavior at relevant concurrency.
45. Optimize throughput only inside quality and latency constraints; use goodput or an equivalent SLO-qualified measure where useful.
46. Load-test overload behavior, queueing, memory/KV-cache pressure, provider quotas, and dependency failure.
47. Quantization, speculative decoding, batching, caching, and model compression are contextual optimizations; every change needs quality regression evidence.
48. Cache only outputs/embeddings/retrieval results whose staleness, privacy, tenant isolation, and invalidation semantics are explicit.
49. Measure total cost per accepted useful outcome, not token price alone.
50. Include retries, fallbacks, tools, retrieval, vector/database cost, observability, human review, engineering, and incident burden where material.
51. Use budgets and admission controls for runaway token, tool, or inference consumption.
52. Instrument model/version/prompt/retriever/router context needed to reproduce material failures without logging unjustified sensitive data.
53. Monitor quality proxies carefully; a proxy is not ground truth.
54. Connect production incidents and user feedback back to reproducible eval cases when possible.
55. Keep a known-failure/limitation register and turn recurring failures into tests or controls.
56. Threat-model prompt injection, data poisoning, model/data supply chain, sensitive-data disclosure, model theft/extraction, improper output handling, excessive capability, and tool misuse where applicable.
57. Treat prompt/system instructions as policy inputs, not security boundaries.
58. Enforce least privilege for model-accessible data and tools.
59. Separate data content from instructions and authority.
60. Apply output encoding/sanitization/validation appropriate to the consumer context.
61. Red-team material systems against realistic abuse and boundary violations, not only policy wording.
62. Guardrails require measured false-positive, false-negative, bypass, latency, and user-friction behavior.
63. Do not let a guardrail silently weaken core availability, accessibility, or legitimate use without product decision ownership.
64. Define safe degradation when a safety classifier, retriever, model, provider, or policy service is unavailable.
65. Do not fail open on high-consequence authorization/safety controls unless explicitly justified by hazard/risk analysis.
66. Preserve auditability of consequential model-mediated decisions/actions at the level required by risk and applicable rules.
67. Document model/system intended use, excluded use, key limitations, evaluation evidence, and operating assumptions.
68. Keep model/provider licensing, data-use terms, regional constraints, and deprecation policy visible to owners.
69. Treat provider model aliases or silent version changes as dependency risk; pin versions where supported and monitor change notices.
70. Re-evaluate when a material model, prompt, retrieval corpus/index, embedding model, policy, or tool changes.
71. Use controlled rollout, shadow traffic, canaries, or staged exposure when production evidence is valuable and blast radius justifies it.
72. Define stop/rollback/roll-forward criteria before material releases.
73. Remember that rolling back code may not roll back index/data/feedback/memory side effects.
74. Preserve the ability to disable AI capability and fall back to a safe path when the business consequence warrants it.
75. Treat user corrections, escalations, and overrides as product signals, not merely noise.
76. Avoid feedback loops that train on model-generated or behaviorally influenced data without provenance and contamination controls.
77. Track model/data drift separately from prompt/configuration/provider/retrieval drift.
78. Separate monitoring signals that detect change from evidence that the change is harmful.
79. Maintain incident ownership and a process for security, quality, data, cost, and provider failures.
80. Retire models, indexes, datasets, prompts, tools, and credentials deliberately; remove stale dependencies and access.
81. For predictive ML, evaluate decision thresholds, calibration, class imbalance, delayed labels, and downstream decision cost—not only ranking/accuracy metrics.
82. Distinguish **data drift**, **concept drift**, **label/prevalence shift**, **provider/model drift**, and **system/configuration drift** because they imply different responses.
83. A drift detector is a diagnostic signal, not proof that task performance degraded.
84. Synthetic or model-generated data MUST retain provenance and SHOULD be evaluated for coverage loss, error amplification, privacy leakage, and feedback-loop effects before material use.
85. Model-generated outputs MUST NOT silently become trusted training labels or retrieval truth merely because they are machine-readable.
86. For material eval comparisons, report uncertainty appropriate to the sampling and stochasticity; use paired or repeated designs when they materially improve decision confidence.
87. Predeclare primary acceptance criteria for consequential releases where hindsight-driven metric selection could change the decision.
88. Do not optimize repeatedly against the only protected acceptance set; keep fresh or shadow evidence where gaming/overfitting risk is material.
89. For LLM judges, randomize/order-balance comparative evaluations where position bias is plausible and revalidate when the judge model or rubric changes.
90. For RAG, govern ingestion, chunking, embedding, indexing, deletion, freshness, and rebuild/reconciliation—not only query-time retrieval.
91. A document removed from the source of truth SHOULD have a tested removal path from derived indexes, caches, embeddings, and retrieval replicas when retention rules require deletion.
92. For external model/provider acquisition, assess capability evidence, data-use terms, model/version identity, security posture, availability/quotas, deprecation policy, region/residency, licensing, observability, and exit strategy proportionate to risk.
93. Untrusted model artifacts, adapters, serialized objects, containers, and model-hub dependencies MUST be handled as software supply-chain inputs, not as inert data.
94. Multimodal systems require modality-specific evaluation; text-only safety, quality, or accessibility evidence MUST NOT be assumed to transfer to image, audio, video, or sensor inputs/outputs.
95. Quality monitoring SHOULD define what can be measured immediately, what requires delayed ground truth, and how sampled human/domain review closes the gap.
96. Provider failover is permitted only within a defined **fallback envelope**: the backup path must have enough quality, safety, policy, latency, and data-handling evidence for the scenarios it may serve.
97. Distinguish rollback of software/configuration from reversal of model-mediated side effects, feedback data, indexes, caches, external messages, or tool actions; use compensation or roll-forward when rollback cannot restore the prior state.
98. Treat AI system quality as a vector of outcomes; do not collapse safety, factuality, latency, cost, fairness, privacy, and task success into one opaque score.
99. Review volatility per component: a frozen model in a stable embedded system may be moderate, while external LLM APIs, model aliases, security threats, and regulatory guidance can be fast-changing.
100. Preserve uncertainty. When evidence is model-, task-, population-, or time-bound, encode the boundary condition instead of promoting the finding to universal AI doctrine.

---

# 10. Requirements and acceptance contracts

## 10.1 Define the AI task contract

```yaml
system_or_feature:
user_population:
intended_task:
decision_or_action_supported:
out_of_scope:
acceptable_failure:
unacceptable_failure:
abstention_behavior:
escalation_behavior:
quality_metrics:
quality_thresholds:
slice_requirements:
latency_slo:
availability_slo:
cost_budget:
security_privacy_constraints:
human_review_requirement:
regulatory_overlay:
```

## 10.2 Separate model and system acceptance

A model can pass component tests while the system fails due to retrieval, routing, prompt assembly, tool execution, policy, UI, or infrastructure. Research on ML underspecification further shows that systems with similar held-out performance can behave differently under deployment-relevant conditions [UNDERSPEC].

Acceptance SHOULD include:

- model/component quality;
- end-to-end task success;
- safety/security guardrails;
- human usability;
- latency under representative load;
- total cost;
- recovery/fallback;
- observability;
- material slices/failure modes.

---

# 11. Data engineering for AI/ML

## 11.1 Data contract

ISO/IEC 5259 provides current standardized data-quality measures and lifecycle process guidance for analytics/ML; mature production research likewise shows that data validation and training/serving skew are first-class production concerns [ISO-5259][GOOGLE-DATA-VALIDATION].

For each dataset/corpus/stream:

```yaml
id:
owner:
purpose:
source:
collection_method:
rights_or_license:
population:
time_range:
sampling:
schema:
label_definition:
quality_checks:
sensitive_data:
retention:
deletion:
lineage:
version:
known_biases:
known_gaps:
allowed_uses:
prohibited_uses:
```

## 11.2 Quality dimensions

Assess as relevant:

- accuracy/correctness;
- completeness;
- consistency;
- timeliness/freshness;
- uniqueness/duplication;
- representativeness;
- label quality;
- provenance;
- schema validity;
- semantic validity;
- contamination/leakage;
- security/integrity;
- rights/consent/purpose fit.

## 11.3 Splits and leakage

Train/validation/test design MUST reflect the actual deployment question. Consider:

- entity leakage;
- duplicate/near-duplicate leakage;
- future-to-past temporal leakage;
- user/session leakage;
- benchmark contamination;
- prompt/template leakage;
- retrieval-corpus overlap;
- downstream tuning on holdout failures.

## 11.4 Feedback data

User feedback and production outcomes are not automatically unbiased labels. Feedback may be shaped by:

- existing model behavior;
- UI choices;
- selective exposure;
- survivorship;
- moderation;
- missing ground truth;
- user incentives;
- delayed outcomes.

Do not train directly on feedback streams without analyzing these mechanisms.

## 11.5 Synthetic and model-generated data

Synthetic data, distilled labels, self-generated traces, and model-generated examples can expand coverage or reduce acquisition cost, but they can also amplify model errors, narrow diversity, reproduce hidden biases, leak source material, and create self-reinforcing feedback loops.

For material use, record:

```yaml
synthetic_source_model_or_generator:
source_data:
generation_policy:
filtering_and_deduplication:
human_or_reference_validation:
coverage_comparison:
privacy_leakage_check:
error_amplification_check:
proportion_of_final_dataset:
allowed_use:
version:
```

Model-generated data MUST retain provenance. It MUST NOT silently become ground truth merely because it is convenient or machine-readable.

## 11.6 Labeling and annotation operations

Where labels or human judgments are material, define:

- annotation instructions and examples;
- annotator competence and access;
- ambiguity and `cannot_determine` handling;
- sampling strategy;
- quality review / adjudication;
- disagreement analysis;
- sensitive-data handling;
- versioning of guidelines;
- whether label policy matches the production decision.

Disagreement is not always noise. It can reveal an underspecified task, heterogeneous stakeholder values, or a construct that is not objectively single-valued.

## 11.7 Feature, ingestion and online/offline consistency

For predictive ML and retrieval systems, data pipelines SHOULD define:

- source-of-truth and ingestion semantics;
- schema and semantic validation;
- event time vs processing time where relevant;
- late/missing data behavior;
- offline/online feature parity;
- backfill and replay semantics;
- deletion/retention propagation;
- reconciliation;
- lineage to trained/evaluated artifacts.

Training-serving skew, schema drift, and silent default values can produce valid-looking but wrong predictions; monitor them as production correctness risks.

---

# 12. Predictive and Classical ML Profile

This section prevents the standard from becoming LLM-centric. Apply it to classifiers, regressors, ranking/recommendation systems, anomaly detectors, forecasting systems, computer-vision models, speech models, and other predictive ML systems.

## 12.1 Decision threshold is part of the product

A model score is not the business decision. When outputs are thresholded or ranked, define:

```yaml
model_output:
decision_threshold_or_policy:
false_positive_cost:
false_negative_cost:
abstain_or_review_region:
capacity_constraint:
protected_slices:
calibration_requirement:
threshold_owner:
review_trigger:
```

Thresholds SHOULD be selected against the consequence of errors and operational capacity, not a generic `0.5`.

## 12.2 Class imbalance and prevalence

Accuracy can be misleading under class imbalance or changing prevalence. Choose metrics that match the decision, such as precision, recall, specificity, sensitivity, PR-AUC, ROC-AUC, calibration error, ranking metrics, or expected cost, and report the population/prevalence to which they apply.

## 12.3 Calibration

If predicted probabilities drive decisions, prioritization, pricing, triage, or risk thresholds, evaluate calibration for the relevant population and slices. A high ranking metric does not imply probability calibration.

Recalibration MAY be preferable to retraining when ranking remains useful but probability mapping shifts.

## 12.4 Distribution shift and out-of-distribution behavior

Evaluate plausible shifts:

- temporal shift;
- geography/site shift;
- device/sensor shift;
- demographic or segment shift;
- product/policy changes;
- upstream feature changes;
- adversarial or strategic adaptation.

Do not assume an OOD detector proves safety. It is one signal whose operating characteristics need evaluation.

## 12.5 Delayed and censored ground truth

Production labels can arrive late, selectively, or never. Monitoring design SHOULD distinguish:

- immediately observable input/data health;
- prediction distribution and confidence/calibration proxies;
- delayed outcome labels;
- sampled human/domain review;
- causal effects that cannot be inferred from prediction accuracy alone.

## 12.6 Recommendation, ranking and feedback loops

Systems that change what users see can change the future data they learn from. Consider:

- exposure bias;
- popularity reinforcement;
- selective labels;
- exploration vs exploitation;
- strategic user adaptation;
- long-term/user-welfare outcomes;
- counterfactual evaluation needs.

Observed clicks or downstream behavior are not automatically unbiased relevance labels.

## 12.7 Explainability and interpretability

Use explanations when they serve a real decision, assurance, debugging, user, or regulatory need. Explanations SHOULD be evaluated for fidelity/usefulness in the target context; a plausible-looking explanation is not proof of the model's true causal reasoning.

## 12.8 Predictive ML release gate

In addition to the universal release gate, verify as relevant:

- data/feature schema and skew checks;
- threshold policy;
- calibration;
- class/prevalence assumptions;
- critical slices;
- delayed-ground-truth monitoring;
- retraining trigger and promotion gate;
- feature/store/model version alignment;
- feedback-loop risks.

---

# 13. Model strategy and selection

## 13.1 Model selection criteria

Evaluate:

- representative task quality;
- critical slice quality;
- robustness/adversarial behavior;
- structured output/tool performance;
- modality support;
- context behavior;
- latency/throughput;
- deployment footprint;
- price and total cost;
- availability/rate limits;
- privacy/data-use policy;
- geographic/residency constraints;
- licensing/IP constraints;
- provider change/deprecation controls;
- observability/debuggability;
- portability/exit cost.

## 13.2 Pareto selection

Do not collapse model choice into one score unless the weighting is explicit and defensible. Prefer a Pareto view across quality, latency, cost, risk, and control.

## 13.3 Hosted vs self-hosted

Hosted is favored when managed operations, frontier capability, rapid updates, or elastic scale dominate and data/control constraints are acceptable.

Self-hosted is favored when control, locality, predictable heavy utilization, custom runtime, model access, or provider independence justify infrastructure and operational burden.

Neither is universally cheaper, safer, or faster.

## 13.4 Model and provider acquisition due diligence

For material external models or inference providers, assess proportionately:

```yaml
provider_or_project:
model_identity_and_versioning:
capability_evidence:
local_eval_status:
context_and_output_limits:
data_retention_and_training_terms:
security_and_incident_process:
model_artifact_provenance:
availability_and_quotas:
region_and_residency:
license_and_ip_terms:
deprecation_and_change_notice:
observability_and_support:
export_or_exit_strategy:
concentration_risk:
owner:
```

Vendor documentation is authoritative about its own supported contract; it is not independent proof that the model is accurate, safe, secure, or optimal for the task.

## 13.5 Model-change classes

Classify changes so the evaluation burden is proportional:

- **Patch-like:** documented runtime fix with no intended model behavior change; still verify critical regressions when impact is uncertain.
- **Configuration:** decoding/context/system-instruction changes; re-evaluate affected behavior.
- **Minor behavior:** model/provider revision intended to improve behavior without contract break; run representative regression + critical slices.
- **Major behavior:** new model family, architecture, tokenizer, modality, tool behavior, or policy regime; treat as a material release.
- **Opaque provider change:** unknown/insufficiently specified behavior change; assume material until local evidence bounds the impact.

Aliases such as `latest` SHOULD NOT be used for C2+ production dependencies when a stable version can be pinned and behavior change would be material.

---

# 14. Training, fine-tuning and post-training

Every material training/adaptation run SHOULD be reconstructable enough for its risk class:

```yaml
base_model:
base_model_digest_or_version:
dataset_versions:
data_filters:
training_code_revision:
environment:
hyperparameters:
seed_or_randomness_controls:
checkpoint:
training_metrics:
evaluation_suite_version:
safety_evals:
owner:
approval:
```

Fine-tuning SHOULD be chosen for a defined behavior/capability gap, not because it sounds more advanced than prompting or RAG. ML systems also accumulate hidden debt through data dependencies, feedback loops, configuration, and entanglement; adaptation choices must be evaluated as system changes rather than isolated model improvements [ML-DEBT].

Post-training changes MUST be regression-tested against protected capabilities and failure classes. Continuous/automated retraining MUST NOT auto-promote without a release gate proportional to consequence.

## 14.1 Fine-tuning decision rule

Fine-tuning is most defensible when local evidence shows a stable behavior/capability gap that cannot be met adequately with simpler prompting, retrieval, tools, or deterministic logic. It SHOULD have a hypothesis such as:

> “For population X and tasks Y, adaptation Z is expected to improve metric A while keeping guardrails B/C within thresholds.”

Fine-tuning MUST NOT be represented as a generic mechanism for keeping volatile factual knowledge current.

## 14.2 Training data and post-training safety

Before material training/adaptation, review:

- data provenance and rights;
- sensitive content and secrets;
- label/synthetic-data quality;
- duplication and leakage;
- poisoning/backdoor risk;
- representation gaps;
- alignment/safety regressions;
- catastrophic forgetting or protected-capability regression;
- memorization/privacy risk where relevant.

## 14.3 Reproducibility and lineage

Exact bitwise reproducibility is not always feasible in large distributed training. The required standard is **decision-relevant reproducibility**: enough lineage to explain which data, code, base model, configuration, environment, and artifacts produced the release and to rerun the material evaluation path.

## 14.4 Continuous and scheduled retraining

Retraining MAY be automated; promotion SHOULD remain gated by the same acceptance contract as a manually trained model. A mature automatic pipeline MAY automate that gate, but the gate MUST include rollback/holdout logic and must not equate “newer” with “better.”

---

# 15. Inference and serving

## 15.1 Serving contract

Define:

- supported model/version;
- request schema;
- max input/output/context limits;
- decoding configuration;
- concurrency limit;
- queueing policy;
- timeout/cancellation;
- batching policy;
- cache semantics;
- load-shedding behavior;
- fallback policy;
- rate/quota behavior;
- hardware/runtime assumptions;
- telemetry.

## 15.2 Generative latency decomposition

Where relevant measure:

```text
request arrival
→ queue delay
→ preprocessing / retrieval / tool latency
→ prefill / time to first token
→ decode / inter-token latency
→ postprocessing / validation
→ end-to-end completion
```

Measure distributions and tail behavior, not only mean latency.

## 15.3 Serving optimization rule

Apply optimizations such as batching, paged KV-cache management, quantization, speculative decoding, compilation, caching, or disaggregated prefill/decode only when local measurements show the quality/latency/cost trade-off is favorable. Peer-reviewed systems work demonstrates large gains from mechanisms such as iteration-level scheduling, PagedAttention/KV-cache management, and prefill/decode disaggregation in studied workloads, but those gains are runtime/model/workload dependent [ORCA][VLLM][DISTSERVE].

## 15.4 SLO-qualified goodput

Raw tokens/second or requests/second can be misleading if requests violate latency or quality objectives. Where serving efficiency is material, measure an SLO-qualified throughput/goodput such as:

```text
successful requests or output tokens
that satisfy the declared quality + latency envelope
per unit time / resource
```

The exact definition is workload-specific.

## 15.5 Benchmark discipline

Serving benchmarks MUST record enough workload detail to be comparable:

- model/version and precision;
- hardware/runtime;
- batch/concurrency;
- prompt/context length distribution;
- output length distribution;
- streaming vs non-streaming;
- latency percentile/SLO;
- warm/cold state;
- quantization/speculative-decoding settings;
- power/resource constraints where material.

Industry benchmarks such as MLPerf are useful standardized evidence, but local production workloads still require local measurement.

## 15.6 Nondeterminism and reproducibility

Do not promise deterministic output from a decoding parameter alone unless the complete serving contract demonstrates it. Provider routing, model updates, kernels, concurrency, hardware, and numerical behavior can change output. When reproducibility matters, pin all controllable versions/settings and test the actual runtime.

---

# 16. Retrieval-Augmented Generation and knowledge grounding

RAG is a compound system. A passing generation metric can hide poor retrieval; a high-recall retriever can still produce unusable context; a grounded answer can still answer the wrong question. RAGAS is useful evidence that RAG evaluation has distinct retrieval, faithful-use, and generation dimensions, while MLPerf Inference v6.1 now includes an end-to-end RAG workload—both reinforce whole-pipeline evaluation without making either framework mandatory [RAGAS][MLPERF-61].

## 16.1 RAG pipeline model

```text
QUERY / TASK
→ query interpretation / rewrite
→ candidate retrieval
→ filtering / access control
→ reranking
→ context selection / packing
→ generation / extraction
→ citation / provenance
→ validation / post-processing
```

Every stage SHOULD have an owner, version, observability, and a defined failure policy.

## 16.2 RAG ingestion and index lifecycle

The retrieval path begins before a query exists. Production RAG SHOULD govern:

```text
SOURCE DISCOVERY
→ authorization / source classification
→ acquisition / parsing
→ normalization
→ chunking / segmentation
→ metadata enrichment
→ embedding / indexing
→ validation / reconciliation
→ serving
→ refresh / re-index
→ deletion / revocation propagation
→ retirement
```

For material corpora define:

- canonical source of truth;
- source authority and trust class;
- parser/version;
- chunking strategy and overlap;
- metadata schema;
- embedding model/version;
- vector/index configuration;
- freshness target;
- incremental update semantics;
- delete/revoke semantics;
- duplicate/conflict handling;
- integrity/reconciliation checks;
- rollback/rebuild strategy.

A successful index build is not proof that the index reflects the source of truth. Reconciliation and deletion tests are required where stale or unauthorized retrieval creates material risk.

## 16.3 Retrieval quality

Measure dimensions relevant to the use case:

- recall of needed evidence;
- precision/relevance;
- ranking quality;
- coverage across source types;
- freshness;
- access-control correctness;
- duplicate/noise rate;
- contradictory-source handling;
- retrieval latency and cost.

Do not optimize retrieval metrics without checking answer/system outcomes.

## 16.4 Context assembly

Context assembly SHOULD define:

- maximum retrieved items/tokens;
- source prioritization;
- deduplication;
- chronological/freshness rules;
- access filters;
- handling of conflicting evidence;
- quoting/citation policy;
- instructions-vs-data separation;
- truncation/packing behavior.

More context is not automatically better. TACL evidence shows substantial position sensitivity in tested long-context models, including degradation when relevant information appears in the middle of long inputs; newer models may improve, so the durable rule is to evaluate position/distractor behavior locally rather than assume perfect context use [LOST-MIDDLE].

## 16.5 Grounding and citations

If factual traceability matters, the system SHOULD preserve a machine-readable mapping between response claims and supporting source material when practical.

Citation presence alone is not evidence that the citation supports the claim. Citation verification is a separate evaluation dimension.

## 16.6 Source authority, contradiction and freshness

Similarity is not authority. Where factual consequence matters, ranking MAY incorporate source authority, recency, provenance, jurisdiction, or document status in addition to semantic relevance.

When sources conflict, the system SHOULD have an explicit policy: present the disagreement, prefer an authoritative/current source under defined rules, request clarification, or escalate. Silent arbitrary selection is weak assurance.

Define a freshness objective when source staleness matters, for example maximum acceptable index lag or a rule that high-volatility facts require live authoritative lookup rather than cached corpus retrieval.

## 16.7 Deletion and revocation propagation

Where source content must be removed, the deletion path SHOULD cover relevant derived state:

- chunks;
- embeddings;
- indexes;
- caches;
- replicas;
- generated summaries/materialized views where applicable;
- evaluation/training reuse subject to the applicable retention basis.

Test that deleted or revoked documents are no longer retrievable inside the required window.

## 16.8 RAG security

Treat the corpus and retrieved text as untrusted unless its trust status is explicitly stronger. Test:

- prompt/instruction injection embedded in documents;
- malicious metadata;
- poisoned or manipulated retrieval results;
- cross-tenant retrieval;
- hidden sensitive content;
- stale revoked documents;
- access-control bypass through search/index layers;
- indirect tool triggering from retrieved content.

---

# 17. Prompt, context and instruction engineering

Prompts are executable configuration for probabilistic systems. They SHOULD be versioned, reviewed, tested, and released like other behavior-changing configuration.

## 17.1 Instruction hierarchy

Separate and label:

- system/developer policy;
- user request;
- retrieved data;
- tool outputs;
- memory/context;
- examples/demonstrations.

Untrusted content MUST NOT be allowed to redefine authorization or security policy.

## 17.2 Prompt quality

A production prompt SHOULD make explicit where relevant:

- role/task;
- required inputs;
- output contract/schema;
- constraints;
- uncertainty/abstention behavior;
- source-use rules;
- forbidden actions;
- escalation behavior;
- examples only where they improve reliability.

Do not use prose instructions to replace enforceable validation or authorization.

## 17.3 Context budgets

Treat context as a limited resource. Optimize for decision-relevant evidence, not maximum token fill. Measure:

- context utilization;
- useful-evidence recall;
- distractor sensitivity;
- truncation failures;
- position sensitivity;
- latency/cost impact.

---

# 18. Evaluation, TEVV and acceptance evidence

Evaluation is the central control system of production AI. For material systems, no single method is sufficient: NIST AI 200-3 explicitly frames holistic evaluation as a combination of **Model Testing, Red Teaming, and User Testing**, while NIST AI 800-4 shows why deployed monitoring is a separate evidence source rather than an optional afterthought [NIST-ARIA][NIST-MON].

## 18.1 Evaluation layers

Use multiple layers when material:

1. **Component/model evaluation** — model or subsystem behavior in isolation.
2. **Task/system evaluation** — end-to-end success on representative workflows.
3. **Behavioral/slice evaluation** — specific capabilities, populations, edge cases, and known failure modes.
4. **Adversarial/red-team evaluation** — misuse, attack, stress, boundary violations.
5. **Human/user evaluation** — usefulness, comprehension, trust calibration, workload, accessibility.
6. **Integration/operational evaluation** — tools, retrieval, policies, retries, failures, capacity.
7. **Post-deployment monitoring/evaluation** — real-world behavior and emerging effects.

## 18.2 Eval specification

```yaml
eval_id:
owner:
version:
decision_supported:
intended_population:
task_distribution:
critical_slices:
failure_taxonomy:
dataset_source:
contamination_controls:
reference_or_ground_truth:
metric_or_rubric:
judge:
human_calibration:
sampling_method:
repetitions_or_randomness:
baseline:
acceptance_threshold:
guardrail_thresholds:
uncertainty_reporting:
latency_cost_measurement:
red_team_cases:
production_monitor_link:
retest_trigger:
```

## 18.3 Eval-set portfolio

For material systems, maintain distinct sets such as:

- representative regression/golden set;
- critical-slice set;
- known-failure set;
- adversarial/challenge set;
- fresh or rotating contamination-resistant set;
- shadow/holdout set not used for optimization;
- production-derived incident set with privacy controls.

Do not tune endlessly against the only acceptance set.

## 18.4 Metrics

Choose metrics from the decision and failure mode. Possible categories:

- task accuracy/success;
- ranking/retrieval metrics;
- factual support/grounding;
- calibration/abstention;
- safety/policy violation;
- human preference/usefulness;
- latency/goodput;
- cost per accepted outcome;
- fairness/slice disparity;
- robustness under perturbation;
- tool/action correctness;
- recovery/fallback behavior.

No metric is universal.

## 18.5 Statistical and decision design

For consequential comparisons, the evaluation design SHOULD state:

- unit of analysis;
- sampling frame and inclusion/exclusion rules;
- paired vs unpaired comparison;
- number of cases/repetitions and why it is sufficient for the decision;
- uncertainty interval or other decision-relevant uncertainty;
- effect size, not only significance, where statistical testing is used;
- multiple-slice/multiple-metric interpretation;
- missing/ambiguous-label handling;
- non-inferiority or guardrail thresholds when the goal is “cheaper/faster without material quality loss”;
- decision rule before seeing the final result when hindsight bias is material.

Do not turn statistical ritual into false precision. The purpose is to distinguish robust improvement from noise and sampling accident at the consequence level that matters.

## 18.6 Baselines and ablations

Every meaningful AI improvement claim SHOULD have a relevant baseline. Depending on the decision this may be:

- current production system;
- non-AI deterministic workflow;
- human workflow;
- smaller/cheaper model;
- model without RAG/reranker/guardrail/router;
- prior model version;
- simple heuristic.

Use ablations when they clarify which component actually creates the measured benefit. A complex system SHOULD NOT receive credit for a component that adds cost/risk without measurable value.

## 18.7 Stochastic systems

Where randomness materially affects outcomes, use repeated trials or sufficiently large samples and report uncertainty rather than one lucky run. Preserve decoding/runtime settings with the result.

For comparative generative evals, use paired cases where practical so both candidates face the same prompts/contexts. Randomize or balance response order when the evaluator can exhibit position bias.

## 18.8 Evaluation contamination and overfitting

Treat an evaluation set as compromised for independent assurance when its content or labels have been materially exposed to training, tuning, prompt optimization, retrieval, or repeated manual selection in a way that can inflate performance.

Controls include:

- data lineage and duplicate detection;
- fresh/rotating challenge sets;
- hidden holdouts;
- time-based test sets;
- contamination-resistant/live questions where appropriate;
- limits on iterative tuning against protected acceptance sets.

Benchmark contamination does not make a model useless; it weakens what can be inferred from that benchmark.

## 18.9 LLM-as-judge

LLM judges MAY be used for scalable evaluation where the rubric can be validated, but MUST NOT be assumed unbiased or equivalent to human ground truth. ACL 2024 evidence demonstrates that response order alone can materially skew comparative rankings in some judge setups [LLM-FAIR-JUDGE]. Risks include:

- position/order bias;
- verbosity/style preference;
- self/model-family preference;
- sensitivity to rubric wording;
- inconsistent reasoning;
- correlated errors with the evaluated model.

For consequential use, calibrate the judge against representative human/domain judgments and periodically re-check after model/rubric changes.

## 18.10 Human evaluation

Human evaluators require:

- clear rubric and examples;
- competence appropriate to the task;
- blinded/randomized presentation where bias matters;
- disagreement handling;
- sampling plan;
- burden and accessibility considerations;
- privacy controls.

Use inter-rater agreement only when the construct warrants it; disagreement can reveal ambiguity rather than evaluator failure.

## 18.11 Evaluation evidence package for C2+ releases

Retain enough evidence for a competent reviewer to reconstruct the release decision:

- eval specification/version;
- exact candidate system versions;
- dataset/eval-set lineage;
- raw or reproducible aggregate results;
- critical-slice results;
- red-team findings;
- human/judge calibration evidence;
- latency/cost measurements;
- known failures and accepted residual risk;
- approver/decision record;
- linked production monitoring plan.

A dashboard screenshot alone is not an assurance package.

---

# 19. Hallucination, factuality, uncertainty and abstention

“Hallucination” is too broad to be a useful production requirement by itself. The literature documents multiple hallucination/factuality failure forms and measurement approaches; methods such as FActScore show the value of decomposing long-form factual output into supportable atomic claims for some tasks [HALL-SURVEY][FACTSCORE]. Define the failure classes that matter to the actual product.

## 19.1 Practical failure taxonomy

Examples:

- unsupported factual claim;
- contradicted claim;
- fabricated citation/source;
- incorrect extraction;
- wrong entity/date/number;
- stale answer;
- unverified inference presented as fact;
- answer beyond available evidence;
- refusal/abstention when answer was safely available;
- overconfident language despite weak evidence.

## 19.2 Mitigation stack

Depending on task:

- retrieve authoritative evidence;
- use structured tools/APIs/databases;
- constrain output schema;
- require citations/provenance;
- verify claims against evidence;
- decompose long-form factual output into verifiable units;
- use rule-based validators for deterministic properties;
- calibrate thresholds and abstention;
- add human review for high-consequence outputs;
- narrow task scope.

No single technique eliminates hallucination universally.

## 19.3 Confidence

Model probabilities, verbal confidence, self-consistency, or self-reported certainty MUST NOT be treated as calibrated factual probability without empirical validation for the target setting.

Where decisions require calibrated risk estimates, evaluate calibration explicitly and define threshold consequences.

## 19.4 Abstention policy

Define:

```yaml
abstain_when:
request_more_information_when:
escalate_to_human_when:
use_tool_or_retrieval_when:
allow_best_effort_when:
forbidden_to_guess_when:
```

The acceptable abstention/false-refusal rate is a product/risk trade-off, not a generic safety maximum.

---

# 20. Model routing, cascades and ensembles

Routing can reduce cost/latency or improve capability allocation, but adds another learned/control layer. Peer-reviewed routing work shows meaningful quality/cost trade-offs on studied benchmarks, which is evidence that routing can work—not evidence that every workload benefits [HYBRID-LLM][ROUTELLM].

## 20.1 Router contract

```yaml
router_input:
route_options:
quality_target:
cost_target:
latency_target:
features_or_signals:
confidence_or_threshold:
fallback:
unknown_case_behavior:
monitoring:
retraining_or_update_trigger:
```

## 20.2 Evaluate the router itself

Measure:

- route accuracy relative to the intended quality/cost decision;
- quality regret vs always using the stronger model;
- cost savings after fallbacks/retries;
- latency overhead;
- critical-slice misrouting;
- drift;
- failure when a provider/model is unavailable.

## 20.3 Cascade rule

A cascade SHOULD terminate safely and have bounded attempts/cost. It MUST avoid hidden retry amplification.

Self-verification by the same model MAY be a routing signal but SHOULD NOT be the sole high-consequence correctness oracle without local evidence.

---

# 21. Guardrails, policy enforcement and output controls

Guardrails are layered controls, not a magic safety wrapper.

## 21.1 Guardrail layers

1. **Input controls** — validation, abuse/spam screening, policy classification.
2. **Context/retrieval controls** — access checks, sanitization, provenance, injection resistance.
3. **Model constraints** — system instructions, constrained decoding, structured output.
4. **Output controls** — content classification, schema validation, factual checks, encoding/sanitization.
5. **Tool/action controls** — deterministic authorization, parameter validation, value/rate limits, approvals.
6. **Human controls** — review/escalation for selected consequence classes.

## 21.2 Guardrail evaluation

Measure at least where relevant:

- true/false positive rates;
- true/false negative rates;
- bypass success;
- slice disparity;
- latency;
- cost;
- user friction;
- failure-on-unavailability behavior;
- interaction between multiple guardrails.

## 21.3 Enforcement rule

A probabilistic safety classifier can inform policy. It MUST NOT be the only enforcement mechanism for deterministic authorization, tenant isolation, spending limits, destructive actions, or other hard access controls.

---

# 22. Security engineering for AI systems

Use a threat model that spans data, model, orchestration, retrieval, tools, infrastructure, and users. NIST SP 800-218A extends secure development guidance to GenAI and foundation-model producers/acquirers, while OWASP and MITRE provide rapidly updated applied threat discovery [NIST-SSDF-AI][OWASP-LLM-2026][MITRE-ATLAS].

## 22.1 Threat classes

Consider as applicable:

- prompt/instruction injection;
- data poisoning;
- model poisoning/backdoors;
- malicious model/dependency artifacts;
- supply-chain compromise;
- training/evaluation data leakage;
- sensitive-information disclosure;
- insecure output handling;
- tool/function misuse;
- excessive capability/agency;
- authentication/authorization failures;
- cross-tenant access;
- model extraction/theft;
- membership/privacy inference;
- denial-of-wallet/resource abuse;
- denial of service;
- memory/context poisoning;
- retrieval poisoning;
- unsafe code/command generation;
- insecure plugin/MCP/tool servers where used.

Risk lists such as OWASP and MITRE ATLAS are threat-discovery aids, not complete assurance standards.

## 22.2 Model/data supply chain

For external models/datasets/adapters/embeddings/runtime artifacts record as justified:

- origin/provider;
- version/digest;
- license/rights;
- training/data-use claims available;
- integrity/provenance evidence;
- vulnerability/security history;
- update/deprecation policy;
- trust level;
- evaluation performed locally.

## 22.3 Model artifacts, hubs and runtime supply chain

Weights, adapters, tokenizers, serialized objects, model containers, custom model code, CUDA/runtime extensions, and model-hub packages are software supply-chain inputs. They MAY execute code or influence privileged runtime behavior depending on the format/toolchain.

For C2+ systems:

- prefer safe/declared serialization formats where feasible;
- avoid loading untrusted custom code into privileged environments;
- verify artifact identity/digest/signature or provenance when supported;
- scan and sandbox untrusted artifacts proportionate to risk;
- pin dependencies/runtime images;
- separate model-download permissions from production deployment authority;
- retain the model/provider/source identity used by each release.

## 22.4 Prompt injection boundary

Retrieved/user/tool content is data, not authority. Systems SHOULD separate instruction channels technically where possible and enforce permissions independently of generated text.

## 22.5 Security evaluation and threat intelligence

Use OWASP GenAI guidance, MITRE ATLAS, provider advisories, internal incidents, and relevant security research as **threat-discovery inputs**, not as complete certification checklists [OWASP-LLM-2026][MITRE-ATLAS].

Security evals SHOULD include attack success rate and consequence, not only whether the model produced disallowed text. Test end-to-end exploit paths through retrieval, tools, parsers, output consumers, identity, and external systems.

## 22.6 Sensitive data

Do not expose secrets or unjustified sensitive data to prompts, logs, retrieval stores, model providers, or feedback pipelines. Apply data minimization and redaction at the earliest practical boundary.

---

# 23. Privacy and data governance

AI systems create new data stores and derivatives:

- prompts/conversations;
- embeddings;
- vector indexes;
- fine-tuning datasets;
- model checkpoints/adapters;
- telemetry/traces;
- safety classifications;
- user feedback;
- cached outputs;
- tool/action histories.

Each material store SHOULD have purpose, access, retention, deletion, export, backup, and provider-processing rules.

Privacy controls MUST cover the full lifecycle, not only the primary application database.

## 23.1 Provider and model data-use controls

For hosted models and external services, record as relevant:

- whether prompts/outputs are retained;
- retention duration and region;
- whether customer data can be used for provider training/improvement;
- opt-out or contractual controls;
- subprocessors;
- abuse/safety logging exceptions;
- deletion/export mechanisms;
- incident notification terms.

Do not infer these behaviors from product branding; verify the applicable contract/documentation for the chosen service tier.

## 23.2 Memorization, extraction and derived-data risk

Where sensitive training/fine-tuning data or proprietary corpora are used, consider threats such as memorization, model inversion/extraction, membership inference, embedding leakage, and retrieval exfiltration proportionate to the threat model.

A transformed representation is not automatically non-sensitive.

---

# 24. Observability and post-deployment monitoring

Pre-deployment evaluation cannot reveal all production behavior. NIST AI 800-4 explicitly identifies post-deployment monitoring as crucial for validating real-world reliability, unforeseen outputs, and unexpected consequences, while noting that validated monitoring methods remain immature in parts of the field [NIST-MON]. Monitoring SHOULD therefore answer both ordinary operations questions and AI-specific quality questions without pretending every proxy is validated ground truth.

## 24.1 Production telemetry model

Capture only what is justified, but preserve enough context to reconstruct material behavior:

- system/model version;
- prompt/config version;
- retriever/index version;
- router route;
- tool calls and outcomes;
- guardrail decisions;
- latency stages;
- token/compute usage;
- error/fallback/abstention state;
- user outcome or sampled quality signal;
- incident/correction link.

Sensitive input/output logging SHOULD be minimized, redacted, sampled, access-controlled, or replaced with derived metrics where full content is not justified.

## 24.2 Monitoring categories

Monitor as relevant:

- functionality/task quality;
- model/output behavior;
- retrieval health;
- data/feature drift;
- operational reliability;
- latency/capacity;
- cost/resource usage;
- human factors/user behavior;
- security/abuse;
- privacy/compliance;
- large-scale or downstream impact.

## 24.3 Drift taxonomy

Distinguish:

- input/data distribution drift;
- label/outcome prevalence drift;
- concept drift;
- feature/schema drift;
- training-serving skew;
- model/provider behavior drift;
- prompt/config drift;
- retrieval corpus/index drift;
- policy/guardrail drift;
- user behavior/adaptation;
- adversarial adaptation.

A drift signal SHOULD trigger diagnosis, not automatic retraining by default.

## 24.4 Quality SLOs and delayed ground truth

A production AI system MAY define quality SLOs, but the measurement method must match how quickly truth becomes available. Distinguish:

- **immediate hard signals:** schema validity, tool success, policy violations, retrieval failures;
- **fast proxies:** sampled judge scores, user corrections, refusal rate, citation support checks;
- **human/domain samples:** reviewed cases drawn from production;
- **delayed ground truth:** churn, fraud confirmation, clinical outcome, repayment, conversion, defect discovery, or other later outcomes.

Proxy SLOs MUST NOT be represented as direct end-outcome evidence when the relationship has not been validated.

## 24.5 Monitoring sampling and privacy

Full-content logging is often unnecessary or unsafe. Choose an explicit sampling strategy based on risk and diagnostic value. Preserve rare/high-severity events even when routine traffic is sampled, and apply access/retention controls to captured prompts, outputs, retrieved text, embeddings, and traces.

## 24.6 Monitoring decision rules

For material signals define:

```yaml
signal:
population:
baseline:
threshold_or_detection_method:
owner:
action_if_triggered:
false_alarm_risk:
ground_truth_delay:
review_cadence:
```

A monitoring alert without a decision path is telemetry noise.

---

# 25. Latency, performance and capacity

## 25.1 Latency metrics

Depending on system type use:

- request end-to-end latency;
- p50/p90/p95/p99 or relevant percentiles;
- queue time;
- retrieval latency;
- reranking latency;
- time to first token;
- inter-token / time per output token;
- tool latency;
- guardrail latency;
- batch wait time.

## 25.2 Capacity

Model:

- requests/sec;
- concurrent sequences;
- input/output token distribution;
- context length distribution;
- GPU/accelerator memory;
- KV-cache pressure;
- batching efficiency;
- provider quotas;
- vector/search throughput;
- network/egress;
- tool/dependency capacity.

## 25.3 Goodput

Where useful, measure **requests/tokens completed inside quality + latency SLOs**, rather than raw throughput alone.

## 25.4 Load and stress testing

Test representative and adversarial workloads, including long contexts, burst traffic, dependency slowdown, retries, provider throttling, hot tenants, and guardrail/tool amplification.

---

# 26. Cost and resource engineering

## 26.1 Total AI cost

Track material components:

- model input/output tokens or compute;
- accelerator reservation/utilization;
- retrieval/search/vector storage;
- embeddings and indexing;
- reranking;
- tools/external APIs;
- retries/fallbacks;
- caching;
- observability/log storage;
- data acquisition/labeling;
- human review;
- engineering and operations;
- incidents/rework;
- vendor minimums/egress/licensing.

## 26.2 Decision denominator

Prefer:

```text
total cost / accepted useful outcome
```

over cost/request when low-quality requests cause retries, human repair, or downstream failure.

## 26.3 Cost controls

Use as relevant:

- smaller models;
- routing/cascades;
- prompt/context reduction;
- caching;
- batching;
- quantization;
- speculative decoding;
- retrieval/reranking optimization;
- output-length limits;
- budget/rate limits;
- asynchronous/batch paths;
- reserved capacity vs on-demand trade-offs.

Each optimization MUST preserve acceptance criteria.

## 26.4 Cost attribution and unit economics

For material systems, attribute cost by the decision unit that can be acted on:

- tenant/customer;
- product feature;
- workflow/task;
- model/provider;
- retrieval/tool path;
- region/environment;
- success/failure/fallback state.

Cost anomalies SHOULD be diagnosable to a component or traffic pattern rather than visible only as a monthly bill.

## 26.5 Capacity economics

For self-hosted or reserved inference, model:

```text
reserved capacity cost
+ utilization / idle cost
+ peak headroom
+ autoscaling delay
+ accelerator fragmentation
+ model loading / cache residency
+ network / storage / egress
+ operations labor
```

For hosted APIs, model request/token pricing together with minimums, batch discounts, caching, retries, rate limits, provider failover, and egress/tool costs.

The cheapest unit price can have the worst cost per accepted outcome if quality or latency causes rework.

## 26.6 Cost guardrails

For workloads exposed to untrusted users or recursive orchestration, define bounded input/output length, concurrency, request rate, retry/fallback count, and tool/model budget. Cost exhaustion is both an economic and availability threat.

---

# 27. Reliability, resilience and dependency failure

Treat every external model, vector store, search service, guardrail, tool, and model gateway as a dependency that can be slow, unavailable, wrong, throttled, or changed.

Define:

- timeout/deadline;
- cancellation;
- retries and retry budget;
- idempotency for actions;
- fallback/degraded mode;
- circuit/resource isolation where justified;
- queue bounds;
- provider failover;
- overload/load shedding;
- recovery verification.

A fallback model or provider is not safe merely because it returns an answer. It requires parity/behavior evaluation for the intended fallback scope.

## 27.1 Fallback envelope

Define exactly what degraded path may do:

```yaml
fallback_trigger:
fallback_model_or_process:
allowed_tasks:
prohibited_tasks:
quality_floor:
safety_policy:
data_handling:
latency_slo:
user_disclosure_if_needed:
recovery_to_primary:
```

A weaker fallback MAY be acceptable for summarization while being prohibited for a high-consequence decision.

## 27.2 Semantic dependency failure

Treat these as failures even when the API is technically `200 OK`:

- output schema/meaning changes;
- policy/refusal behavior changes;
- tokenizer/context limit changes;
- model alias points to new behavior;
- tool-call format changes;
- embedding distribution changes;
- retrieval provider ranking behavior changes.

Contract tests and behavior canaries SHOULD cover semantic dependencies that matter.

---

# 28. Human factors, UX and calibrated reliance

A trustworthy AI system must help users understand **what the system can and cannot be relied on for** without creating unusable friction.

Design for:

- clear task scope;
- visible uncertainty where useful;
- understandable citations/evidence;
- correction/undo;
- escalation;
- disclosure of AI use where required or material;
- distinction between suggestion and committed action;
- accessibility;
- protection against automation bias and over-trust;
- protection against alert/refusal fatigue.

Human-in-the-loop is only effective when the human receives enough context, time, authority, and comprehensible evidence to intervene meaningfully.

## 28.1 Calibrated reliance

Interfaces SHOULD help users form an appropriate mental model of reliability. Avoid both:

- **over-trust:** fluent output is treated as authoritative despite uncertainty;
- **under-trust:** excessive warnings/refusals make safe useful capability unusable and teach users to ignore warnings.

Where mistakes are consequential, show the evidence, source, confidence/uncertainty signal only when it is meaningful, and an easy path to verify, correct, undo, or escalate.

---

# 29. Multimodal and Modality-Specific AI Systems

Text-centric controls do not automatically transfer to vision, audio, video, sensor, spatial, or multimodal systems. Each modality changes the data, threat, accessibility, latency, and evaluation surface.

## 29.1 Modality-specific evidence

Evaluate as relevant:

- image resolution/cropping/compression/lighting;
- audio noise, accents, microphones, languages, speaker overlap;
- video frame rate, temporal ordering, scene transitions, occlusion;
- OCR/layout/diagram/table understanding;
- sensor calibration, missingness, synchronization, and physical environment;
- cross-modal consistency between text, image, audio, or video;
- accessibility alternatives and user interaction needs.

A text safety evaluation MUST NOT be presented as evidence that an image/audio/video pathway has equivalent safety behavior.

## 29.2 Multimodal security and privacy

Consider:

- hidden/embedded instructions in images/documents/audio;
- steganographic or adversarial content;
- biometric or location information;
- EXIF/metadata leakage;
- malicious files/codecs/parsers;
- cross-modal prompt injection;
- inappropriate retention of recordings/images;
- downstream generation of sensitive visual/audio content.

## 29.3 Multimodal performance

Measure modality preprocessing and transport separately from model inference when they materially affect end-to-end latency/cost. Large media inputs can shift bottlenecks to storage, network, transcoding, decoding, or retrieval rather than model compute.

---

# 30. MLOps, configuration, artifacts and provenance

Treat as controlled artifacts:

- training code;
- model checkpoints/weights/adapters;
- tokenizer;
- preprocessing/feature code;
- prompt/system instructions;
- embedding model;
- retriever/reranker;
- index/corpus snapshot;
- tool schemas;
- guardrail models/rules;
- router model/rules;
- runtime/container;
- inference configuration;
- evaluation suite;
- deployment manifest.

For a material release, be able to identify the versions that produced the observed behavior.

## 30.1 Registry and promotion state

A model/artifact registry or equivalent controlled inventory SHOULD distinguish states such as:

```text
EXPERIMENTAL → EVALUATED → APPROVED → DEPLOYED → RESTRICTED / ROLLED_BACK → RETIRED
```

Promotion SHOULD reference the eval evidence and exact artifact identity. Production systems MUST NOT load an arbitrary “best/latest” experiment by convention.

## 30.2 Environment and dependency capture

Where reproducibility matters, retain as applicable:

- source revision;
- container/runtime image digest;
- ML framework/compiler versions;
- accelerator/runtime driver versions;
- model artifact digest;
- tokenizer/preprocessor versions;
- feature/index schema;
- dependency lock/provenance;
- deployment configuration.

## 30.3 AI configuration as controlled state

Prompts, system messages, routing thresholds, safety policies, model parameters, feature definitions, index settings, tool schemas, and evaluator rubrics SHOULD live in auditable/versioned configuration when changing them can change production behavior.

---

# 31. Release and deployment

## 31.1 Pre-release gate

Pass only when:

- acceptance/eval suite passes;
- no unresolved blocker security/privacy/safety defects;
- critical slices pass;
- latency/cost capacity is acceptable;
- observability is ready;
- fallback/disable path is tested;
- provider/model version is explicit;
- data/index versions are explicit;
- rollout and stop criteria are defined;
- incident owner is known.

## 31.2 Exposure strategies

Use as appropriate:

- offline replay;
- shadow evaluation;
- internal/dogfood cohort;
- limited beta;
- canary traffic;
- percentage/segment rollout;
- human-reviewed phase;
- full release.

Production evidence is useful only if failure can be detected and contained quickly enough.

## 31.3 Change-to-evaluation matrix

| Change | Minimum default evidence for C2+ |
|---|---|
| Prompt/system instruction | affected regression + critical slices + policy checks |
| Model minor version | representative regression + slices + latency/cost + safety/security deltas |
| New model/provider | full release suite + fallback/ops/security/privacy review |
| Embedding model/index strategy | retrieval + end-to-end RAG + deletion/access + latency/cost |
| Corpus refresh | freshness/access/deletion checks + representative RAG regression |
| Guardrail/policy | safety + false-positive/negative + usability + degraded-mode tests |
| Router threshold/model | route quality/regret + net cost/latency + critical-slice routing |
| Quantization/runtime optimization | quality equivalence/regression + performance/capacity |
| Training/fine-tuning data | model + safety + slice + contamination/privacy regression |

These are defaults; consequence can require more.

## 31.4 Rollback and compensation

Before release identify which state is actually reversible. Rolling back a model binary does not undo:

- messages already sent;
- tool actions;
- user decisions;
- feedback captured;
- index/corpus mutations;
- caches;
- generated data promoted downstream;
- external side effects.

Where reversal is impossible, design compensation, containment, or roll-forward instead of calling a code rollback a complete recovery plan.

---

# 32. AI incident response

Incident classes include:

- harmful/unsafe output;
- systematic quality regression;
- sensitive data disclosure;
- security exploit/prompt injection;
- cross-tenant retrieval;
- model/provider outage;
- runaway cost;
- routing failure;
- guardrail failure;
- stale/poisoned data or retrieval;
- unauthorized tool action;
- provider behavior/version change;
- feedback-loop corruption.

## 32.1 Severity factors

Classify severity from consequence, not novelty or media attention. Consider:

- users affected and vulnerability;
- unsafe/incorrect decision consequence;
- sensitive-data/security impact;
- unauthorized external actions;
- financial loss or runaway spend;
- duration and ongoing exposure;
- regulatory/contractual notification requirements;
- whether the failure is systematic/reproducible or isolated;
- whether containment is available.

Response sequence:

```text
DETECT
→ CONTAIN CAPABILITY / TRAFFIC / DATA ACCESS
→ PRESERVE EVIDENCE
→ RESTORE SAFE SERVICE OR FALLBACK
→ VERIFY
→ COMMUNICATE / REPORT AS REQUIRED
→ ROOT-CAUSE / CONTRIBUTING CONDITIONS
→ ADD EVAL / CONTROL / MONITORING
→ REGRESSION TEST
```

Preserve the exact model/config/index/prompt/tool versions involved where feasible.

---

# 33. Maintenance, retraining, updates and retirement

## 33.1 Update triggers

Re-evaluate on:

- model/provider version change;
- prompt/system instruction change;
- embedding/retriever/reranker change;
- index/corpus change;
- data distribution or product population change;
- policy/guardrail change;
- tool/API behavior change;
- new attack technique;
- quality/cost/latency regression;
- incident;
- new legal/contractual requirement;
- benchmark/eval methodology change;
- provider deprecation.

## 33.2 Retraining decision

Retrain/adapt only when evidence identifies a problem that training can plausibly address. Data drift alone is insufficient.

## 33.3 Retirement

Retirement SHOULD include:

- dependent workflow discovery;
- migration plan;
- model endpoint shutdown;
- credential revocation;
- index/cache cleanup;
- data retention/deletion action;
- evaluation-set/archive requirements;
- provider billing cleanup;
- monitoring removal;
- documentation update;
- removal of obsolete prompts/policies/adapters/tool schemas that could still be invoked.

---

# 34. Regulatory, Contractual and Domain Overlays

This playbook is an engineering standard, not legal advice. Law, regulation, contract, safety certification, sector policy, and customer commitments can turn a contextual engineering control into a mandatory requirement.

## 34.1 Overlay rule

For each deployment, record:

```yaml
jurisdictions:
provider_role:
deployer_role:
system_classification:
regulated_domain:
applicable_contracts:
required_documentation:
required_human_oversight:
required_logging_or_retention:
required_transparency:
required_incident_reporting:
required_security_privacy_controls:
qualified_legal_or_compliance_owner:
next_review_trigger:
```

## 34.2 EU AI Act watch item — status at 2026-09-27

For EU-scoped systems, use the authoritative regulation and current European Commission guidance rather than this summary. As of the evidence cutoff, the Commission states that general-purpose AI model-provider obligations entered into application on **2 August 2025**, including technical documentation, copyright-policy, and training-content-summary obligations, with additional duties for GPAI models with systemic risk [EU-GPAI].

Article 50 transparency obligations entered into application on **2 August 2026** for relevant providers/deployers; other AI Act obligations follow their own phased dates and scope [EU-ARTICLE50]. Regulatory timelines and guidance are active watch items and MUST be reverified before compliance decisions.

Engineering implication: maintain current role/classification, technical documentation, model/system provenance, downstream capability/limitation information, transparency controls, risk/security evidence, and lifecycle update ownership where applicable.

## 34.3 Standards are not certification by citation

ISO/IEC 42001, 23894, 5338, 42005, 5259 and related standards are valuable management, risk, lifecycle, impact, and data-quality references. Merely citing or partially adopting them does not establish conformity or certification.

---

# 35. Universal AI engineering decision framework

For any material AI decision:

1. Define the user/business outcome.
2. Define unacceptable failures and criticality.
3. Define the simplest credible non-AI baseline.
4. Define evaluation and acceptance criteria.
5. Identify data and trust boundaries.
6. Generate alternatives.
7. Evaluate quality, safety, security, privacy, latency, cost, control, and change risk.
8. Test uncertainty with the cheapest credible experiment.
9. Select the least complex adequate option.
10. Record assumptions and revisit triggers.
11. Release with observable, recoverable exposure.
12. Compare production outcomes with the original causal assumptions.

---

# 36. Core decision trees

## 36.1 Should we use AI?

```text
Can a deterministic rule/search/database/workflow meet the requirement reliably?
  ├─ YES → prefer it unless AI adds demonstrated material value
  └─ NO  → Can AI quality be evaluated on representative cases?
              ├─ NO → build the evaluation method before production dependence
              └─ YES → Is residual probabilistic error acceptable or containable?
                          ├─ NO → use AI only as assistive candidate generation with deterministic/human control
                          └─ YES → proceed with risk-proportionate AI design
```

## 36.2 Prompting vs RAG vs tools vs fine-tuning

```text
Need current/authoritative external knowledge?
  ├─ YES → prefer retrieval or authoritative tool/API access
  └─ NO  → Is the gap behavior/style/format/task adaptation?
              ├─ YES → test prompting/examples first; then fine-tuning if evidence justifies it
              └─ NO  → Is bounded source material already available in context?
                          ├─ YES → test long-context approach
                          └─ NO → reframe task/model choice
```

These can be combined. Evaluate the combined system.

## 36.3 Bigger model?

Use a larger model only when it materially improves critical acceptance criteria enough to justify latency/cost/control trade-offs. Do not upgrade based on prestige or benchmark average alone.

## 36.4 Add routing?

Add a router/cascade when model-quality heterogeneity across requests is large enough that local evidence shows meaningful net benefit after routing error, latency, fallbacks, operations, and monitoring.

## 36.5 RAG vs long context

Test both when practical. Long context may simplify retrieval but can degrade with distractors/position/size; RAG adds retrieval/index/security complexity. Choose from representative end-to-end evidence.

## 36.6 Hosted vs self-hosted

Compare total lifecycle cost, capability, data control, performance, availability, security, compliance, operational skill, provider dependency, and exit cost.

---

# 37. Core Production AI Plays

These are the default operational units. They inherit the Atomic Play Standard from Playbook 00.

## 37.1 PLAY-AI-001 — Qualify an AI use case

**Objective:** decide whether AI should be used and what assurance posture applies.

**Use when:** introducing AI into a new product/workflow or materially expanding scope.

**Inputs:** user/business outcome, current baseline, users/stakeholders, data, consequence, constraints.

**Method:**
1. Define the decision/task and non-AI baseline.
2. Identify unacceptable failures and system criticality.
3. Check whether AI error can be evaluated and contained.
4. Map sensitive data, permissions, external dependencies and legal/domain overlays.
5. Define an initial acceptance contract.
6. Choose `R1–R4` rigor and owners.

**Output:** approved AI experiment/production brief or a documented decision not to use AI.

**Acceptance:** scope, baseline, criticality, owners, initial eval plan and forbidden behaviors are explicit.

## 37.2 PLAY-AI-002 — Select a production model/system path

**Objective:** choose the least complex adequate model/architecture from evidence.

**Method:**
1. Establish representative eval set and minimum acceptance criteria.
2. Compare realistic alternatives, including smaller/cheaper models and non-AI baseline.
3. Evaluate quality, critical slices, latency, cost, data handling, provider risk and operations.
4. Decide whether RAG, tools, fine-tuning, routing or long context solve a demonstrated gap.
5. Record trade-offs and evidence margin.

**Guardrail:** benchmark leadership alone MUST NOT determine selection.

## 37.3 PLAY-AI-003 — Build or revise the evaluation suite

**Objective:** create decision-relevant evidence that can detect regressions and critical failures.

**Method:**
1. Define the release/product decision the eval supports.
2. Build representative, critical-slice, known-failure and adversarial sets.
3. Define metrics/rubrics, ground truth, uncertainty and judge calibration.
4. Protect holdout/fresh sets against optimization leakage.
5. Add system, latency/cost and human/user tests where material.
6. Link production incidents back into regression cases.

**Acceptance:** each material risk/requirement is traceable to an appropriate eval/monitoring signal or explicit rationale.

## 37.4 PLAY-AI-004 — Release a material AI change

**Trigger:** change to model, provider, fine-tune, prompt/system policy, retriever/index, embedding, guardrail, router, tool contract or serving runtime that can materially affect behavior.

**Method:**
1. Identify exact changed artifacts and invalidated evidence.
2. Run the change-to-evaluation matrix and security/privacy checks.
3. Validate latency/cost/capacity and fallback.
4. Set rollout cohort, observation window and stop criteria.
5. Release progressively when production evidence is valuable.
6. Verify post-release signals and record decision.

**Failure path:** stop exposure, revert/compensate/roll forward, preserve evidence, open incident when thresholds require it.

## 37.5 PLAY-AI-005 — Diagnose a production quality regression

**Objective:** distinguish model failure from data, retrieval, configuration, provider, user, or monitoring change.

**Diagnostic order:**
1. Confirm the measurement/ground truth did not change.
2. Segment by model/version, prompt/config, route, tenant, data source and time.
3. Check input/data/schema/prevalence drift.
4. Check retrieval/index freshness and access behavior.
5. Check provider/model alias/runtime changes.
6. Reproduce against the protected eval and incident sample.
7. Identify whether degradation is task quality, calibration, safety, refusal, latency or cost.
8. Choose targeted remediation; do not retrain by reflex.

## 37.6 PLAY-AI-006 — Respond to external provider/model change

**Trigger:** provider announces or silently exposes a new model/version, deprecation, pricing, context, safety, tool or API behavior.

**Method:**
1. Pin/hold current version if supported and needed.
2. Classify the change as patch-like, configuration, minor behavior, major behavior or opaque.
3. Run proportionate regression and critical-slice evals.
4. Recheck latency/cost, rate limits, data-use terms and fallback parity.
5. Approve, delay, narrow, or migrate.
6. Update the system card, source register and review trigger.

---

# 38. Architecture review checklist

- [ ] Real outcome and user population defined
- [ ] Non-AI baseline considered
- [ ] Criticality assigned
- [ ] System boundary includes data/model/retrieval/tools/guardrails
- [ ] Trust boundaries explicit
- [ ] Hard controls outside model where required
- [ ] Data provenance/rights/quality understood
- [ ] Model selection based on local eval
- [ ] RAG/context/tool design has failure semantics
- [ ] Evaluation portfolio covers representative + critical + adversarial cases
- [ ] Latency/cost capacity modeled
- [ ] Observability and incident path designed
- [ ] Fallback/disable path exists
- [ ] Version/provenance plan exists
- [ ] Regulatory/domain overlay checked

---

# 39. Data readiness checklist

- [ ] Dataset/corpus owner
- [ ] Purpose and allowed use
- [ ] Source/provenance
- [ ] Rights/license/consent where applicable
- [ ] Population/time range
- [ ] Sensitive data classification
- [ ] Label definitions and quality process
- [ ] Leakage/contamination checks
- [ ] Representative deployment slices
- [ ] Schema/semantic validation
- [ ] Retention/deletion
- [ ] Train/eval separation
- [ ] Poisoning/integrity threat considered
- [ ] Version and lineage recorded

---

# 40. Model and eval release checklist

- [ ] Model/version/digest explicit
- [ ] Intended/excluded use documented
- [ ] Eval suite version explicit
- [ ] Representative system eval passes
- [ ] Critical slices pass
- [ ] Known failure regression passes
- [ ] Adversarial/red-team coverage appropriate
- [ ] LLM judge calibrated where materially used
- [ ] Human/domain review where consequence warrants
- [ ] Hallucination/factuality policy tested
- [ ] Abstention/escalation tested
- [ ] Structured outputs validated
- [ ] Latency/cost under load passes
- [ ] Security/privacy review passes
- [ ] Provider/data-use terms checked
- [ ] Monitoring/rollback/disable ready

---

# 41. RAG production checklist

- [ ] Corpus ownership and freshness
- [ ] Access control enforced before/within retrieval
- [ ] Retrieval recall/relevance evaluated
- [ ] Reranking evaluated if used
- [ ] Context packing/truncation tested
- [ ] Contradictory sources handled
- [ ] Source provenance preserved
- [ ] Citation support evaluated
- [ ] Prompt injection in documents tested
- [ ] Cross-tenant leakage tested
- [ ] Revoked/deleted document removal verified
- [ ] End-to-end factuality/task quality evaluated
- [ ] Latency/cost measured
- [ ] Index/embedding model versioned
- [ ] Fallback when retrieval is weak/unavailable defined

---

# 42. AI security review checklist

- [ ] Threat model covers model/data/retrieval/tools/infrastructure/users
- [ ] Untrusted prompt/retrieval content isolated from authority
- [ ] Authentication/authorization enforced outside model
- [ ] Least-privilege data/tool access
- [ ] Sensitive data minimized/redacted
- [ ] Structured output validated
- [ ] Prompt injection tested
- [ ] Data/retrieval poisoning considered
- [ ] Model/dependency provenance assessed
- [ ] Cross-tenant isolation tested
- [ ] Resource/denial-of-wallet abuse bounded
- [ ] Tool/action values/rates/approvals enforced
- [ ] Logging does not leak secrets/data
- [ ] Incident/revoke/kill path works
- [ ] Guardrail bypass and failure tested

---

# 43. Production readiness checklist

- [ ] Product/engineering/model/data owners named
- [ ] Critical user journeys and failure classes identified
- [ ] Model/system acceptance contract exists
- [ ] Eval evidence current
- [ ] Data quality and lineage current
- [ ] Capacity/latency tested
- [ ] Total cost understood
- [ ] Provider quotas/dependencies understood
- [ ] Observability and alerts ready
- [ ] Fallback/degraded mode tested
- [ ] Security/privacy controls verified
- [ ] Release cohort and stop criteria defined
- [ ] Incident response ownership established
- [ ] Review/re-evaluation triggers configured
- [ ] Model/system card current

---

# 44. AI Definition of Ready

A production AI initiative or material change is ready to build when:

- [ ] intended users, task and decision/outcome are explicit;
- [ ] non-AI/current baseline is known;
- [ ] system criticality `C0–C4` and playbook rigor `R1–R4` are selected;
- [ ] unacceptable failures and forbidden actions are listed;
- [ ] owner(s) and decision rights are known;
- [ ] data/knowledge sources, rights, sensitivity and trust boundaries are known enough to start;
- [ ] evaluation question, representative population and critical slices are defined;
- [ ] initial quality/latency/cost/security/privacy acceptance criteria exist;
- [ ] model/provider/RAG/fine-tune/tool alternatives are not prematurely fixed without rationale;
- [ ] applicable regulatory/domain overlays are identified;
- [ ] production monitoring and rollback/fallback implications have been considered;
- [ ] R3/R4 traceability/independent review needs are scoped.

---

# 45. AI Definition of Done

A C2+ production AI release can be considered technically done for release only when all applicable conditions pass:

## 45.1 Scope and architecture
- [ ] intended/excluded use and critical user journeys are current;
- [ ] exact system boundary and behavior-affecting artifact versions are known;
- [ ] hard authorization and irreversible-action controls are outside model persuasion;
- [ ] fallback/degraded behavior is explicit.

## 45.2 Data and model
- [ ] data/model/provider provenance is sufficient for risk;
- [ ] rights/privacy/retention requirements are addressed;
- [ ] training/eval leakage and material synthetic-data risks are addressed;
- [ ] provider/model changes are pinned or monitored appropriately.

## 45.3 Evaluation
- [ ] representative system eval passes;
- [ ] critical slices and known failures pass;
- [ ] adversarial/security tests are proportionate;
- [ ] human/user testing is complete where material;
- [ ] judge calibration and uncertainty are adequate where automated judges materially affect release;
- [ ] latency/cost/capacity requirements pass;
- [ ] residual uncertainty/risk is visible and accepted by the appropriate owner.

## 45.4 Production assurance
- [ ] observability can identify model/config/index/route involved in material failures;
- [ ] post-deployment quality/operations/security monitoring is defined;
- [ ] rollout and stop criteria are defined;
- [ ] rollback/compensation/disable path is tested;
- [ ] incident ownership and runbook are available;
- [ ] no unresolved BLOCKER defects;
- [ ] MAJOR defects are zero or formally accepted under the applicable governance.

## 45.5 Governance
- [ ] model/system card and change record are current;
- [ ] applicable legal/domain requirements reverified;
- [ ] review/update triggers are set;
- [ ] R3/R4 assurance evidence is retained.

`Done for release` is not `validated forever`; field evidence can invalidate the release assumptions.

---

# 46. Model / AI system card template

```yaml
system_name:
version:
owner:
status:
intended_use:
excluded_use:
users:
criticality:
model_and_provider:
model_version:
data_sources:
retrieval_sources:
tools:
guardrails:
known_limitations:
key_failure_modes:
evaluation_suite:
evaluation_date:
critical_results:
latency_profile:
cost_profile:
security_privacy_notes:
human_oversight:
fallback:
monitoring:
incident_path:
review_triggers:
```

---

# 47. Evaluation plan template

```markdown
# Evaluation Plan

## Decision
What product/release/model decision will this evaluation support?

## Intended users and task distribution

## Unacceptable failures

## Critical slices

## Evaluation portfolio
- representative regression:
- critical slices:
- adversarial/red team:
- human/user evaluation:
- integration/system:
- production monitoring:

## Metrics and rubrics

## Ground truth / reference

## Judge validation

## Baselines

## Thresholds / decision rules

## Uncertainty / repetitions

## Latency and cost

## Contamination controls

## Result
PASS / PARTIAL / FAIL

## Residual risks

## Re-evaluation triggers
```

---

# 48. AI incident template

```yaml
incident_id:
severity:
start:
detection:
containment:
resolution:

user_business_impact:
security_privacy_impact:

model_version:
prompt_policy_version:
retriever_index_version:
router_version:
tool_versions:

trigger:
contributing_conditions:
why_pre_release_eval_missed_it:
why_monitoring_detected_or_missed_it:
blast_radius:

immediate_mitigation:
fallback_used:

follow_up_evals:
follow_up_controls:
owners:
validation_of_fix:
```

---

# 49. Metric dictionary

## 49.1 Quality
- task success / acceptance rate;
- precision/recall/F1 or task-specific metrics;
- human-rated usefulness;
- grounded/factual support;
- refusal/abstention quality;
- tool/action correctness.

## 49.2 Retrieval
- recall@k;
- precision/relevance@k;
- ranking metrics;
- source freshness;
- evidence coverage.

## 49.3 Safety/security
- policy violation rate;
- attack success rate;
- false-positive/negative guardrail rate;
- cross-tenant leakage;
- unauthorized action rate.

## 49.4 Operations
- availability;
- end-to-end latency;
- TTFT;
- inter-token latency;
- queue time;
- error/fallback rate;
- saturation/capacity.

## 49.5 Economics
- cost/request;
- cost/accepted outcome;
- token/compute cost;
- retrieval/tool cost;
- human review/rework cost.

Metrics MUST retain definitions, populations, units, and decision use.

---

# 50. Anti-playbook — production AI claims to resist

## 50.1 “The best benchmark model is the best production model.”
False. Benchmarks are scoped evidence; production fit includes local quality, failure modes, latency, cost, control, privacy, operations, and user value.

## 50.2 “A bigger model is always better.”
False. Larger models can improve some capabilities while worsening latency, cost, footprint, provider dependence, and sometimes task-specific behavior.

## 50.3 “RAG solves hallucinations.”
False. RAG can improve access to evidence while adding retrieval failure, stale/poisoned context, citation mismatch, and prompt-injection risk.

## 50.4 “Long context makes RAG obsolete.”
False as a universal claim. Long-context performance can depend on information position, distractors, and context composition; retrieval may improve focus and cost. Evaluate both.

## 50.5 “More context improves quality.”
False as a universal rule. Irrelevant or conflicting context can degrade answers and increase latency/cost.

## 50.6 “Fine-tuning is how you add knowledge.”
Incomplete. Fine-tuning can adapt behavior and capabilities, but current/authoritative knowledge often fits retrieval or tools better. Evaluate the specific requirement.

## 50.7 “Temperature 0 means deterministic.”
False as a universal production guarantee unless the complete provider/runtime contract demonstrates determinism. Infrastructure, kernels, model updates, routing, and hidden provider changes can still affect outputs.

## 50.8 “LLM-as-judge is ground truth.”
False. Automated judges can show position, verbosity, style, and model-family biases. Calibrate for the target rubric and use independent evidence.

## 50.9 “Model confidence tells us whether the answer is correct.”
False unless calibrated for the specific decision. Verbal confidence and token probabilities are not universal factual probabilities.

## 50.10 “Vector similarity means relevance.”
False. Embedding similarity is one retrieval signal; task relevance, freshness, authority, access, and evidence sufficiency require evaluation.

## 50.11 “Guardrails make an AI system safe.”
False. Guardrails are controls with bypasses and error rates; deterministic policy, permissions, system architecture, monitoring, and human controls remain necessary.

## 50.12 “Human-in-the-loop makes the system safe.”
False. Human review can become rubber-stamping and cannot compensate for opaque scale, weak context, bad interfaces, or excessive permissions.

## 50.13 “Routing always lowers cost.”
False. Router errors, duplicated calls, fallbacks, retries, latency, and operational complexity can erase savings.

## 50.14 “Self-hosting is cheaper.”
Workload-dependent. Infrastructure utilization, staffing, reliability, security, and opportunity cost can dominate.

## 50.15 “Hosted APIs are more expensive.”
Workload-dependent. Elasticity and managed operations can dominate at many utilization profiles.

## 50.16 “Quantization is free performance.”
False. Quality, calibration, latency, throughput, memory, and hardware behavior must be re-evaluated.

## 50.17 “Average latency is enough.”
False for interactive/loaded systems. Tail latency, TTFT, decode rate, queueing, and dependency stages can dominate experience.

## 50.18 “Token price is AI cost.”
False. Retrieval, tools, retries, human review, data, observability, infrastructure, and failures can dominate total cost.

## 50.19 “Drift means retrain.”
False. Drift is a change signal. The correct response depends on whether task performance or assumptions actually degraded and whether retraining addresses the cause.

## 50.20 “Offline evals prove production safety.”
False. Production inputs, users, attackers, feedback loops, dependencies, and changing environments create behavior not fully observable pre-release.

## 50.21 “A safety benchmark proves safety.”
False. It is evidence for the tested scenarios and protocol, not exhaustive threat coverage.

## 50.22 “A model card makes the model trustworthy.”
False. Documentation improves transparency; trust requires actual evidence and controls.

## 50.23 “A provider’s latest alias is a safe upgrade.”
False. Behavior can change; material upgrades need regression evaluation.

## 50.24 “Caching model answers is always safe.”
False. Privacy, tenant isolation, staleness, personalization, prompt variations, and policy changes matter.

## 50.25 “If the model refuses unsafe content, tool use is safe.”
False. Tool safety depends on external authorization, schemas, limits, and action controls.

---

# 51. Contradiction ledger

| Debate | Evidence-weighted V1 position |
|---|---|
| Large vs small model | Use the least costly model that meets the verified contract; escalate capability where local evidence earns it. |
| RAG vs long context | Neither dominates universally; retrieval focus/control vs context simplicity must be tested. |
| Prompting vs fine-tuning | Prompting is lower-friction; fine-tuning can improve specialized behavior; choose from eval evidence. |
| RAG vs fine-tuning | Often solve different problems: external/updatable knowledge vs behavior/capability adaptation; can be combined. |
| Hosted vs self-hosted | Managed simplicity/capability vs control/locality/steady-load economics; model lifecycle cost. |
| Single model vs routing | Routing can lower cost but adds failure/control complexity; use only with measurable net benefit. |
| Human judge vs LLM judge | Humans provide domain judgment but are costly/variable; LLMs scale but are biased/correlated. Calibrate and combine. |
| Offline vs online eval | Offline enables controlled comparison; online reveals real behavior. Both are needed for material systems. |
| Precision vs recall in guardrails | Depends on harm of false allow vs false block; no universal threshold. |
| More retrieval vs focused retrieval | Higher recall can add noise/distractors; optimize end-to-end outcome. |
| Determinism vs diversity | Deterministic-like settings aid reproducibility; sampling can improve candidate diversity/uncertainty testing. Match task. |
| Fallback vs fail closed | Availability benefit vs risk of weaker behavior. Choose from consequence and parity evidence. |
| Continuous retraining vs controlled releases | Continuous adaptation can react faster but increases change risk and provenance burden. |
| Model monitoring vs outcome monitoring | Model proxies are early signals; business/user ground truth is stronger when available but can be delayed. Use both. |
| Safety vs helpfulness | Over-blocking can make systems unusable; thresholds are risk/product decisions, with hard legal/safety constraints where applicable. |

---

# 52. Failure-mode catalogue

## 52.1 Data failures
- missing/incorrect labels;
- leakage/contamination;
- stale data;
- schema drift;
- demographic/domain underrepresentation;
- duplicated/near-duplicated examples;
- poisoned data;
- rights/provenance uncertainty;
- feedback-loop contamination.

## 52.2 Model failures
- poor generalization;
- underspecification;
- shortcut learning;
- calibration failure;
- brittle slice behavior;
- unsafe completion;
- structured output failure;
- model/provider regression.

## 52.3 RAG/context failures
- relevant evidence not retrieved;
- irrelevant distractors dominate;
- stale evidence;
- contradictory evidence mishandled;
- malicious document injection;
- access-control leakage;
- context truncation/position sensitivity;
- citation does not support claim.

## 52.4 Routing failures
- weak request sent to expensive path unnecessarily;
- hard request sent to insufficient model;
- route drift;
- router outage;
- recursive fallback;
- duplicate billing/calls.

## 52.5 Guardrail failures
- unsafe false negative;
- harmful false positive/refusal;
- bypass/jailbreak;
- guardrail outage;
- conflicting classifiers;
- latency amplification;
- inconsistent policy versions.

## 52.6 Operational failures
- provider outage/throttle;
- queue overload;
- GPU/resource exhaustion;
- runaway token/tool cost;
- cache poisoning/staleness;
- observability blind spot;
- rollback incompatibility.

## 52.7 Human/system failures
- automation bias;
- ignored warnings;
- unclear source/citation presentation;
- review overload;
- inaccessible interaction;
- ambiguous escalation;
- users adapt behavior in ways not represented in evals.

---

# 53. Traceability spine

For AI-C2+ systems, maintain traceability proportionate to risk:

| Requirement / risk | Evidence | Design/control | Eval/test | Production signal | Owner | Status |
|---|---|---|---|---|---|---|

Critical controls SHOULD have no unexplained orphan state: a risk with no control, a control with no test, a test with no requirement/risk, or a production signal with no decision use.

---

# 54. Governance and decision rights

Minimum roles where material:

- product/outcome owner;
- engineering/system owner;
- model/ML owner;
- data owner;
- security/privacy owner;
- evaluation/assurance owner;
- operations/incident owner;
- legal/compliance/domain specialist when required.

A single person MAY hold multiple roles in small teams, but accountability and conflict/separation requirements MUST remain explicit.

High-consequence acceptance SHOULD receive competent independent challenge.

---

# 55. Review cadence and event triggers

AI systems are FAST-volatility artifacts. Use scheduled and event-driven review.

Default review cadence SHOULD be risk- and provider-change-based rather than one universal interval.

Review immediately when:

- provider/model behavior materially changes;
- a serious incident occurs;
- new exploit/attack class appears;
- data population shifts;
- legal obligations change;
- key evals regress;
- costs/latency become material constraints;
- critical dataset/index changes;
- guardrail/policy changes;
- usage expands to a higher-risk context.

Disposition: retain / refresh / partial update / full update / withdraw / watch.

---

# 56. One-page V2 standard

```text
1. DEFINE TASK + USERS + CONSEQUENCE
2. ASK WHETHER AI IS NEEDED
3. DEFINE ACCEPTANCE + FAILURE BEFORE MODEL CHOICE
4. MAP DATA / MODEL / RETRIEVAL / TOOLS / GUARDRAILS / HUMAN BOUNDARIES
5. CHOOSE THE LEAST COMPLEX ADEQUATE SYSTEM
6. VERSION EVERY BEHAVIOR-AFFECTING COMPONENT
7. EVALUATE COMPONENT + SYSTEM + SLICES + ADVERSARIAL + HUMAN
8. KEEP HARD AUTHORIZATION OUTSIDE THE MODEL
9. TREAT RAG/CONTEXT AS UNTRUSTED, VERSIONED PRODUCTION STATE
10. DEFINE HALLUCINATION / ABSTENTION IN TASK-SPECIFIC TERMS
11. MEASURE LATENCY DISTRIBUTIONS + TOTAL COST PER ACCEPTED OUTCOME
12. RELEASE GRADUALLY WITH FALLBACK / DISABLE / INCIDENT PATH
13. MONITOR REAL QUALITY, OPERATIONS, SECURITY, COST AND HUMAN EFFECTS
14. TURN FAILURES INTO EVALS, CONTROLS AND DESIGN CHANGES
15. RE-EVALUATE ON MODEL / DATA / PROMPT / INDEX / TOOL / POLICY CHANGE
16. RETIRE MODELS, DATA, INDEXES, CREDENTIALS AND DEPENDENCIES SAFELY
```

---

# 57. Evidence Map and Annotated Source Register

> **Evidence rule.** Inclusion does not imply equal weight. Standards define terminology/process baselines; empirical papers support scoped claims; mature operator research supports production mechanisms; vendor/platform documentation is strongest for its own contract; community risk lists are threat-discovery aids. Current status is recorded as of **2026-09-27**.

## 57.1 Internal inherited standards

### BASE00 — Master Playbook Standard v2.0-RC1
**Status:** REVIEWED; evidence cutoff 2026-09-27.  
**Used for:** evidence model, claim taxonomy, risk/rigor, traceability, validation, audit, lifecycle status, research and falsification method.  
**Key implication:** this specialist playbook inherits `Outcome → Evidence → Decision → Action → Implementation → Verification → Evaluation → Learning` and MUST remain risk-proportionate.  
**Limitation:** it is a house playbook-construction standard, not an AI engineering standard itself.

### BASE-SE — Universal Software & AI Engineering Master Playbook v2.0
**Status:** Double-validated/falsification-weighted engineering master; research cutoff 2026-09-27.  
**Used for:** system criticality C0-C4, lifecycle engineering, security/reliability/testing/change controls, AI output independence, agent authorization doctrine.  
**Key implication:** AI changes candidate-generation economics but does not lower ordinary engineering assurance obligations.  
**Limitation:** intentionally delegates AI/ML/LLM implementation depth to this specialist playbook.

## 57.2 Current NIST / government AI assurance

### NIST-GENAI — NIST AI 600-1 — Generative AI Profile
**Status:** Published 2024; NIST page current/updated in 2026.  
**Used for:** generative-AI risk management, TEVV, provenance, governance, adversarial testing, human oversight.  
**Limitation:** voluntary cross-sector risk guidance, not one required architecture.  
**URL:** https://www.nist.gov/publications/artificial-intelligence-risk-management-framework-generative-artificial-intelligence

### NIST-ARIA — NIST AI 200-3 — ARIA Evaluation Planning Manual
**Status:** Published **2026-09-18**.  
**Used for:** holistic AI evaluation combining model testing, red teaming and user testing.  
**Finding:** evaluation should combine complementary evidence modes rather than one benchmark or test method.  
**Limitation:** newly published; organizations still need application-specific metrics and thresholds.  
**URL:** https://www.nist.gov/publications/aria-evaluation-planning-manual-elements-aria-style-ai-evaluations

### NIST-MON — NIST AI 800-4 — Challenges to the Monitoring of Deployed AI Systems
**Status:** Published **2026-03-06**.  
**Used for:** post-deployment monitoring, field validation, monitoring categories and methodological uncertainty.  
**Finding:** controlled pre-deployment evaluation cannot account for all dynamic real-world behavior; deployed monitoring is crucial for reliability, unforeseen outputs and unexpected consequences.  
**Limitation:** NIST explicitly notes that validated monitoring methodologies/common terminology remain nascent.  
**URL:** https://www.nist.gov/publications/challenges-monitoring-deployed-ai-systems-center-ai-standards-and-innovation

### NIST-TEVV — NIST AI 200-2 — TEVV-Athlon
**Status:** **Initial Public Draft** announced 2026-08-07; comments open through 2026-10-06 at this cutoff.  
**Used for:** emerging context-specific TEVV planning concepts across ML, LLM, multimodal and agentic systems.  
**Rule:** `EMG`; MUST NOT be represented as final normative guidance.  
**URL:** https://www.nist.gov/artificial-intelligence/ai-research/tevv-athlon-framework-evaluating-ai-systems

### NIST-SSDF-AI — NIST SP 800-218A
**Status:** Final, 2024-07-26.  
**Used for:** secure development practices specific to GenAI and dual-use foundation models, including model producers, system producers and acquirers.  
**Limitation:** secure-development profile; broader quality, privacy, safety and field evaluation need complementary controls.  
**URL:** https://csrc.nist.gov/pubs/sp/800/218/a/final

### NSA-AI-DATA — Joint AI Data Security guidance
**Status:** Published 2025-05-22 by NSA AISC with CISA/FBI/international partners.  
**Used for:** data supply-chain security, data poisoning, drift, provenance, integrity and secure AI data operations.  
**Limitation:** cybersecurity guidance, not complete data-quality or model-quality assurance.  
**URL:** https://www.nsa.gov/Press-Room/Press-Releases-Statements/Press-Release-View/Article/4192332/nsas-aisc-releases-joint-guidance-on-the-risks-and-best-practices-in-ai-data-se/

## 57.3 ISO/IEC AI standards and current status

### ISO-42001 — ISO/IEC 42001:2023 — AI management systems
**Status:** Published/current.  
**Used for:** organizational AI governance, management-system ownership, continual improvement.  
**Limitation:** management-system requirements do not substitute for system-specific technical assurance.  
**URL:** https://www.iso.org/standard/81230.html

### ISO-23894 — ISO/IEC 23894:2023 — AI risk management
**Status:** Published/current.  
**Used for:** risk-management integration across organizations developing, deploying or using AI.  
**Limitation:** customizable guidance, not a fixed control checklist.  
**URL:** https://www.iso.org/standard/77304.html

### ISO-5338 — ISO/IEC 5338:2023 — AI system lifecycle processes
**Status:** Published/current.  
**Used for:** AI-specific lifecycle processes integrated with established system/software lifecycle standards.  
**Limitation:** process framework; does not prescribe one ML architecture, MLOps platform or development method.  
**URL:** https://www.iso.org/standard/81118.html

### ISO-23053 — ISO/IEC 23053:2022 — Framework for AI systems using ML
**Status:** Published; under systematic review. **Generative-AI Amendment 1 is a Final Draft Amendment under development**, not yet published at the cutoff.  
**Used for:** ML-system components/functions and shared system vocabulary.  
**Limitation:** base edition predates current GenAI practice; use the GenAI amendment as a watch item only until publication.  
**URL:** https://www.iso.org/standard/74438.html

### ISO-25059 — ISO/IEC 25059:2023 — Quality model for AI systems
**Status:** Published but marked to be revised; **Edition 2 FDIS is under development** and expected to replace the 2023 edition.  
**Used for:** AI-specific system quality terminology and completeness prompts.  
**Limitation:** current published baseline may change soon; do not silently cite the FDIS as final.  
**URL:** https://www.iso.org/standard/80655.html

### ISO-5259 — ISO/IEC 5259 series — Data quality for analytics and ML
**Status:** Parts 1–4 published in 2024; Part 5 published in 2025; ISO/IEC TR 5259-6 was published in May 2026.  
**Used for:** data-quality terminology, measurable characteristics, management, process, governance and visualization across the ML data lifecycle.  
**Limitation:** the series does not define task-specific sufficient quality thresholds; Part 6 is a Technical Report rather than a requirements standard.  
**URLs:**  
- https://www.iso.org/standard/81088.html  
- https://www.iso.org/standard/81860.html  
- https://www.iso.org/standard/81092.html  
- https://www.iso.org/standard/81093.html  
- https://www.iso.org/standard/84150.html  
- https://www.iso.org/standard/86532.html

### ISO-42005 — ISO/IEC 42005:2025 — AI system impact assessment
**Status:** Published/current.  
**Used for:** lifecycle impact assessment and updating as systems/contexts change.  
**Limitation:** impact-assessment guidance; domain/legal obligations still require scoped interpretation.  
**URL:** https://www.iso.org/standard/42005

### ISO-24027 — ISO/IEC TR 24027:2021 — Bias in AI systems
**Status:** Published Technical Report.  
**Used for:** lifecycle-wide bias/fairness prompts and assessment methods.  
**Limitation:** technical report; exact fairness construct and thresholds remain domain/context dependent.  
**URL:** https://www.iso.org/standard/77607.html

### ISO-24028 — ISO/IEC TR 24028:2020 — Trustworthiness overview
**Status:** Published Technical Report.  
**Used for:** transparency, explainability, controllability, reliability, safety, security and privacy dimensions.  
**Limitation:** overview; does not set universal trustworthiness levels.  
**URL:** https://www.iso.org/standard/77608.html

### ISO-24029 — ISO/IEC TR 24029-1:2021 — Robustness of neural networks
**Status:** Published Technical Report.  
**Used for:** robustness-assessment concepts.  
**Limitation:** overview of methods rather than a universal production robustness test.  
**URL:** https://www.iso.org/standard/77609.html

## 57.4 AI security and adversarial knowledge

### OWASP-LLM-2026 — OWASP GenAI LLM Top 10 2026
**Status:** Released 2026-08-03; latest edition at cutoff.  
**Used for:** fast-moving GenAI/LLM threat discovery and mitigation patterns.  
**Limitation:** community risk-awareness guidance; not a complete verification standard or certification.  
**URL:** https://genai.owasp.org/resource/owasp-genai-llm-top-10-2026/

### OWASP-ACS — OWASP Agent Control Standard
**Status:** Released 2026-09-01.  
**Used for:** inspectability, traceability, instrumentation and runtime policy hooks for agent platforms.  
**Limitation:** very new; implementation maturity and empirical completeness are evolving. Agentic depth belongs primarily to Playbook 19.  
**URL:** https://genai.owasp.org/resource/agent-control-standard-acs/

### MITRE-ATLAS — MITRE ATLAS
**Status:** Living knowledge base.  
**Used for:** adversarial AI tactics/techniques, threat assessment and red-team scenario discovery.  
**Finding:** based on real-world observations and realistic demonstrations.  
**Limitation:** threat knowledge base, not assurance certification or a claim of exhaustive coverage.  
**URL:** https://atlas.mitre.org/

## 57.5 Production ML and data engineering evidence

### ML-DEBT — Sculley et al. — Hidden Technical Debt in Machine Learning Systems
**Status:** NeurIPS 2015; foundational operational engineering paper.  
**Used for:** entanglement, data dependencies, feedback loops, configuration debt, undeclared consumers and external-world change.  
**Limitation:** older systems paper; mechanisms remain relevant but implementation technology has evolved.  
**URL:** https://papers.nips.cc/paper/2015/hash/86df7dcfd896fcaf2674f757a2463eba-Abstract.html

### GOOGLE-MLTEST — Breck et al. — ML Test Score
**Status:** IEEE Big Data 2017 / mature Google production evidence.  
**Used for:** production-readiness tests, data/model monitoring, treating training data like code and models like deployable binaries.  
**Limitation:** Google operational context; the exact scoring rubric is not a universal maturity law.  
**URL:** https://research.google/pubs/the-ml-test-score-a-rubric-for-ml-production-readiness-and-technical-debt-reduction/

### GOOGLE-DATA-VALIDATION — Breck et al. — Data Validation for Machine Learning
**Status:** SysML 2019 production research.  
**Used for:** data anomalies, schema-free failure, training/serving skew and continuous data validation at production scale.  
**Limitation:** Google/TFX implementation context; transfer the mechanism, not the exact tooling.  
**URL:** https://research.google/pubs/data-validation-for-machine-learning/

### UNDERSPEC — D’Amour et al. — Underspecification Presents Challenges for Credibility in Modern ML
**Status:** JMLR 2022.  
**Used for:** why equal held-out performance can hide materially different deployed behavior.  
**Limitation:** does not imply every model is untrustworthy; it motivates stress tests tied to deployment conditions.  
**URL:** https://jmlr.org/papers/v23/20-1335.html

### CALIB — Guo et al. — On Calibration of Modern Neural Networks
**Status:** ICML 2017.  
**Used for:** evidence that predictive probabilities can be miscalibrated and calibration requires explicit evaluation.  
**Limitation:** specific model era/tasks; calibration behavior must be re-measured for current systems.  
**URL:** https://proceedings.mlr.press/v70/guo17a.html

### MODELCARDS — Mitchell et al. — Model Cards for Model Reporting
**Status:** FAT* 2019.  
**Used for:** intended use, limitations and disaggregated evaluation reporting.  
**Limitation:** documentation pattern does not itself create trustworthy behavior.  
**URL:** https://doi.org/10.1145/3287560.3287596

### DATACASCADES — Sambasivan et al. — Data Cascades in High-Stakes AI
**Status:** CHI 2021.  
**Used for:** evidence that upstream data problems compound through downstream ML work and organizations.  
**Limitation:** qualitative study; supports mechanisms and organizational risk, not universal numeric effect sizes.  
**URL:** https://doi.org/10.1145/3411764.3445518

## 57.6 RAG, long context, factuality and evaluation

### LOST-MIDDLE — Liu et al. — Lost in the Middle
**Status:** TACL 2024.  
**Used for:** evidence that tested long-context models can be sensitive to relevant-information position and distractors.  
**Limitation:** model capabilities evolve rapidly; the enduring rule is to test long-context behavior locally rather than import the historical effect size.  
**URL:** https://aclanthology.org/2024.tacl-1.9/

### RAGAS — Es et al. — RAGAs
**Status:** EACL 2024 System Demonstrations.  
**Used for:** decomposing RAG evaluation into retrieval/context and generation/faithfulness dimensions.  
**Limitation:** one evaluation framework; reference-free automated metrics are not universal ground truth.  
**URL:** https://aclanthology.org/2024.eacl-demo.16/

### HALL-SURVEY — Ji et al. — Survey of Hallucination in Natural Language Generation
**Status:** ACM Computing Surveys 2023.  
**Used for:** hallucination definitions, task-specific manifestations, measurement and mitigation landscape.  
**Limitation:** literature predates some current frontier/agentic systems; use taxonomy more durably than historical model rates.  
**URL:** https://doi.org/10.1145/3571730

### FACTSCORE — Min et al. — FActScore
**Status:** EMNLP 2023.  
**Used for:** atomic-fact decomposition as a fine-grained factuality evaluation technique for long-form generation.  
**Limitation:** developed/evaluated on particular factual generation settings; not a universal factuality metric.  
**URL:** https://aclanthology.org/2023.emnlp-main.741/

### CHECKLIST — Ribeiro et al. — CheckList
**Status:** ACL 2020.  
**Used for:** behavioral capability testing and finding failures hidden by aggregate held-out accuracy.  
**Limitation:** NLP testing methodology, not a complete AI system assurance framework.  
**URL:** https://aclanthology.org/2020.acl-main.442/

### LLM-FAIR-JUDGE — Wang et al. — Large Language Models are not Fair Evaluators
**Status:** ACL 2024.  
**Used for:** empirical evidence of position bias in LLM comparative judging and value of calibration.  
**Limitation:** specific judge models/tasks; demonstrates a failure mechanism rather than one universal bias magnitude.  
**URL:** https://aclanthology.org/2024.acl-long.511/

## 57.7 Inference and serving systems evidence

### ORCA — Yu et al. — Orca
**Status:** OSDI 2022.  
**Used for:** generative-serving scheduling and continuous/iteration-level batching mechanisms.  
**Limitation:** specific system/model era; serving trade-offs must be re-measured on current runtimes.  
**URL:** https://www.usenix.org/conference/osdi22/presentation/yu

### VLLM — Kwon et al. — Efficient Memory Management for Large Language Model Serving with PagedAttention
**Status:** SOSP 2023.  
**Used for:** KV-cache memory management and serving throughput mechanisms.  
**Limitation:** reported gains are baseline/hardware/workload dependent.  
**URL:** https://arxiv.org/abs/2309.06180

### DISTSERVE — Zhong et al. — DistServe
**Status:** OSDI 2024.  
**Used for:** separating prefill/decode phases, TTFT/TPOT SLO reasoning and SLO-qualified serving throughput.  
**Limitation:** architecture is contextual; disaggregation adds network/scheduling complexity.  
**URL:** https://www.usenix.org/conference/osdi24/presentation/zhong-yinmin

### SPECDEC — Leviathan et al. — Fast Inference from Transformers via Speculative Decoding
**Status:** ICML 2023.  
**Used for:** semantics-preserving speculative decoding under the studied algorithm/assumptions.  
**Limitation:** speedups depend on draft/target models, hardware and workload.  
**URL:** https://proceedings.mlr.press/v202/leviathan23a.html

### SMOOTHQUANT — Xiao et al. — SmoothQuant
**Status:** ICML 2023.  
**Used for:** post-training quantization as a latency/memory optimization example.  
**Limitation:** quality/performance trade-offs depend on model, hardware and implementation.  
**URL:** https://proceedings.mlr.press/v202/xiao23c.html

### FLASHATTN — Dao et al. — FlashAttention
**Status:** NeurIPS 2022.  
**Used for:** IO-aware exact attention optimization example.  
**Limitation:** implementation/hardware/model-specific; not a universal serving architecture.  
**URL:** https://arxiv.org/abs/2205.14135

### MLPERF-61 — MLPerf Inference v6.1
**Status:** Results released **2026-09-16**.  
**Used for:** current architecture-neutral reproducible inference benchmarking and evidence that benchmarking is moving toward **end-to-end RAG** and **agentic inference** workloads.  
**Limitation:** standardized benchmark workloads still do not replace local quality, traffic, policy, or economics evaluation.  
**URL:** https://mlcommons.org/2026/09/mlperf-inference-v6-1-results/

## 57.8 Routing and cost/quality trade-off evidence

### HYBRID-LLM — Ding et al. — Hybrid LLM
**Status:** ICLR 2024.  
**Used for:** evidence that routing between smaller/larger models can trade quality for cost and reduce large-model calls in studied tasks.  
**Limitation:** experimental workload/model pair; routers introduce their own error and operations surface.  
**URL:** https://www.microsoft.com/en-us/research/publication/hybrid-llm-cost-efficient-and-quality-aware-query-routing/

### ROUTELLM — Ong et al. — RouteLLM
**Status:** ICLR 2025.  
**Used for:** preference-trained LLM routing and benchmarked cost/quality trade-offs.  
**Limitation:** public benchmark results do not prove savings or quality parity for arbitrary private workloads.  
**URL:** https://proceedings.iclr.cc/paper_files/paper/2025/hash/5503a7c69d48a2f86fc00b3dc09de686-Abstract-Conference.html

## 57.9 Regulatory overlay sources

### EU-GPAI — European Commission — GPAI obligations under the AI Act
**Status:** Official Commission guidance; GPAI obligations entered into application **2025-08-02**.  
**Used for:** scoped example of technical documentation, copyright/training-content-summary and systemic-risk obligations.  
**Limitation:** applicability depends on provider role/model classification; legal advice and the authoritative regulation/guidance are required for compliance decisions.  
**URL:** https://digital-strategy.ec.europa.eu/en/factpages/general-purpose-ai-obligations-under-ai-act

### EU-ARTICLE50 — European Commission — Guidelines on transparency obligations for providers and deployers of certain AI systems
**URL:** https://digital-strategy.ec.europa.eu/en/library/guidelines-transparency-obligations-providers-and-deployers-ai-systems  
**Evidence:** `E0/E4 — BINDING_REGULATION_CONTEXT + OFFICIAL_GUIDANCE`  
**Finding:** The Commission states that Article 50 transparency obligations apply from 2 August 2026 and published implementation guidance in July 2026 for providers and deployers in scope.  
**Limitation:** Article 50 covers only a subset of AI Act transparency duties; actor, system, transitional and jurisdictional scope must be assessed from the authoritative regulation and current guidance.

### EU-GPAI-GUIDE — European Commission — Guidelines on obligations for GPAI providers
**Status:** Official current guidance at cutoff.  
**Used for:** lifecycle documentation obligations and downstream capability/limitation information.  
**Limitation:** AI Act-specific and subject to evolving guidance/implementation.  
**URL:** https://digital-strategy.ec.europa.eu/en/faqs/guidelines-obligations-general-purpose-ai-providers

---

# 58. V1 → V2 Deep Audit and Falsification Record

V2 is not a rewrite-for-length pass. V1 was deliberately challenged against current standards, research, adversarial production failure modes, and the inherited Definition of Done.

## 58.1 Falsification targets

The audit attempted to break V1 on:

- model-centric vs system-centric assurance;
- offline evals vs field evidence;
- benchmark contamination and benchmark-to-production inference;
- classical ML undercoverage;
- data quality, synthetic data and feedback loops;
- RAG ingestion/index/deletion lifecycle;
- long-context assumptions;
- hallucination/factuality measurement;
- LLM-as-judge bias and judge independence;
- routing economics and router failure;
- guardrail/authorization confusion;
- model/data/software supply-chain boundaries;
- prompt injection and retrieval poisoning;
- inference latency and goodput;
- quantization/serving optimization equivalence claims;
- total AI cost and denial-of-wallet/resource exhaustion;
- monitoring/drift/retraining logic;
- provider/model semantic drift;
- fallback parity and rollback assumptions;
- multimodal transfer assumptions;
- standards draft/final status;
- regulatory-overreach risk;
- false universal “best practice” claims.

## 58.2 Material changes from V1

1. **Replaced the custom `AI-C0..C4` taxonomy** with the inherited software `C0–C4` criticality plus Playbook `R1–R4` rigor to remove taxonomy collision.
2. **Relaxed false R3 universality:** R2 can be sufficient for low-consequence production; R3 is the default for material customer/data/business dependency; R4 for severe consequence.
3. Added an explicit **AI system quality model** instead of treating one task metric as quality.
4. Added an explicit **end-to-end AI lifecycle** tied to ISO/IEC 5338.
5. Expanded Golden Standards from 80 to **100**, adding statistical eval, synthetic data, ingestion/index lifecycle, acquisition due diligence, multimodal, fallback and source-status rules.
6. Added a dedicated **predictive/classical ML profile** covering thresholds, calibration, class imbalance, delayed labels, distribution shift and feedback loops.
7. Added **synthetic/model-generated data governance** and prohibited silent promotion of model output to ground truth.
8. Expanded **model/provider acquisition** and opaque provider-change handling.
9. Expanded **training/post-training** with hypothesis-driven fine-tuning, protected-capability regression and decision-relevant reproducibility.
10. Strengthened inference around **SLO-qualified goodput**, workload disclosure, TTFT/decode/E2E separation and nondeterminism.
11. Expanded RAG into an **ingestion → parse → chunk → embed → index → reconcile → refresh/delete → retire** lifecycle.
12. Added **source authority, contradiction, freshness and deletion propagation** to RAG.
13. Upgraded evals with **statistical decision design, baselines/ablations, contamination controls, stochastic paired evaluation, judge-order controls and retained assurance evidence**.
14. Grounded multi-method evaluation in **NIST AI 200-3 ARIA** and post-deployment monitoring in **NIST AI 800-4**.
15. Downgraded **TEVV-Athlon** to an explicit `EMG` watch item because it is an Initial Public Draft.
16. Expanded AI security with **model artifact/model-hub supply-chain** controls and end-to-end attack-success evaluation.
17. Expanded privacy with hosted-provider data-use and model/embedding extraction/memorization concerns.
18. Added **quality SLO and delayed-ground-truth monitoring** logic and stronger separation of drift signal from performance evidence.
19. Expanded cost engineering to **cost per accepted outcome**, attribution, reserved-capacity economics and bounded resource budgets.
20. Added **fallback envelopes** and semantic dependency failure for provider/model changes.
21. Added a **multimodal profile** rather than assuming text evaluation transfers to image/audio/video/sensors.
22. Expanded MLOps with **registry/promotion state, environment capture and AI configuration as controlled state**.
23. Added a **change-to-evaluation matrix** and distinguished code rollback from compensation for irreversible AI side effects.
24. Added explicit **incident severity factors**.
25. Added a **regulatory/domain overlay** with current EU GPAI timing as a scoped example rather than universal legal doctrine.
26. Replaced V1’s preliminary source list with this annotated, status-aware evidence map.

## 58.3 Claims deliberately bounded rather than promoted

- **Long context:** evidence supports testing position/distractor sensitivity; it does not prove all future long-context models fail in the middle.
- **RAG:** can improve access to evidence; does not guarantee factuality or remove hallucination.
- **LLM judges:** useful scaling tool; not ground truth and can exhibit position/style/model-family biases.
- **Routing:** can save cost in studied settings; not a default architecture.
- **Quantization/speculative decoding:** potentially large serving gains; quality/equivalence and hardware results remain contextual.
- **Drift:** useful change signal; not automatic evidence that retraining is required.
- **Human-in-the-loop:** one control; not a substitute for system design or understandable review workload.
- **Guardrails:** layered controls; not authorization boundaries or complete safety proof.
- **Benchmark leadership:** evidence about a benchmark; not a production winner.

## 58.4 Residual uncertainties / watch items

1. NIST AI 200-2 TEVV-Athlon can change before finalization.
2. ISO/IEC 25059 Edition 2 is in FDIS and will replace the 2023 edition; refresh the quality crosswalk after publication.
3. ISO/IEC 23053 Generative-AI Amendment 1 is in final-draft approval and is not yet the published baseline.
4. Production post-deployment AI monitoring remains an area where NIST reports incomplete consensus/validated methods.
5. Model/provider capabilities, prices, context limits, APIs and safety behavior remain fast-changing and MUST be locally reverified.
6. Agentic AI security/runtime control is evolving rapidly and Playbook 19 remains the deeper specialist authority.
7. Regulatory timelines/guidance, especially EU AI Act implementation details, require event-driven review and qualified interpretation.

## 58.5 V2 status conclusion

**Research/falsification verdict: PASS for `REVIEWED`.**  
**Not eligible for `VALIDATED` yet.** Under Playbook 00, representative non-author execution, realistic scenario testing, field evidence, and appropriate independent challenge remain required before production validation can be claimed.

---

# 59. Crosswalk to the Master Playbooks

| This playbook requirement | Inherited anchor | Specialist effect |
|---|---|---|
| Evidence / claim fit / uncertainty | Playbook 00 §§7–10 | Adds AI-specific source-status and benchmark rules |
| Rigor / assurance / audit | Playbook 00 §§11, 23–29 | Adds AI criticality and eval evidence package |
| Human+AI machine execution | Playbook 00 §20 | Specializes probabilistic AI system controls |
| Software criticality and lifecycle | Software & AI Master §§5–7 | Uses C0–C4, lifecycle, failure and change doctrine |
| General security/privacy | Software & AI Master §§14–15 | Adds model/data/RAG/prompt/provider threats |
| Reliability/observability | Software & AI Master §§16–18 | Adds AI quality SLO, drift, provider/model semantics |
| Verification/testing | Software & AI Master §24 | Adds TEVV, LLM judges, red teaming, eval portfolios |
| Supply chain | Software & AI Master §§22–23 | Adds models, adapters, tokenizers, model hubs and AI data |
| AI-assisted/agent controls | Software & AI Master §§32–33 | Keeps authorization outside model; delegates deep agents to Playbook 19 |

**Inheritance rule:** where this playbook is silent, the parent engineering standard still applies. This specialist playbook MAY strengthen controls for AI-specific risk but MUST NOT weaken a parent MUST requirement without an explicit governed exception.

---

# 60. Mechanical QA and Release Record

The final V2 artifact was mechanically checked after the research, falsification, and source-status passes.

| Check | Result |
|---|---|
| Numbered top-level sections | 61; sequential `1–61` |
| Numbered subsection hierarchy | PASS; no parent-number mismatches detected |
| Golden Production AI Standards | 100; sequential `1–100` |
| Core Production AI Plays | 6 |
| Markdown code-fence markers | 62; balanced |
| Evidence IDs cited in the normative body | 25 |
| Annotated evidence/source entries defined | 46 |
| Missing cited evidence IDs | 0 |
| Duplicate evidence-ID definitions | 0 |
| Supporting/watch-only evidence entries | 21 |
| Unresolved drafting/insertion markers | 0 |
| Requested production-AI topics | PASS: models, inference, RAG, data, evals, hallucination, routing, guardrails, observability, latency, cost, security, lifecycle |
| Draft/final source-status checks | PASS for material watch items at the 2026-09-27 cutoff |
| V1/DRAFT language | Deliberately retained only in the falsification/change-history context |

**Release disposition:** `REVIEWED`. No mechanical blocker was found. This is not promoted to `VALIDATED`, because Playbook 00 requires representative non-author execution, realistic scenario/field testing, and risk-appropriate independent challenge before that status is justified.

---

# 61. Change Log

## 61.1 2.0 — 2026-09-27

Research-reviewed and deep-falsification-audited production AI/ML/LLM specialist standard.

Major release changes are recorded in the V1 → V2 audit above. Status is `REVIEWED`, not `VALIDATED`.

## 61.2 1.0-DRAFT — 2026-09-27

Initial production-AI synthesis used as the falsification target. Superseded by V2.
