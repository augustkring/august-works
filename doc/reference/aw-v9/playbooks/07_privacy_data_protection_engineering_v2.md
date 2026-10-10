# 07 — Privacy & Data Protection Engineering

## Evergreen standard for privacy-by-design, minimization, purpose, access, telemetry, retention, deletion, privacy threats, rights, AI data use and regulatory engineering constraints

```yaml
document_id: PB-07-PRIVACY
title: "07 — Privacy & Data Protection Engineering"
version: 2.0
status: REVIEWED
status_note: "V1 completed; adversarial/falsification, implementation and freshness audit completed. Independent qualified legal/domain review and representative non-author field execution remain required before VALIDATED."
created: 2026-09-27
last_updated: 2026-09-27
last_reviewed: 2026-09-27
evidence_cutoff: 2026-09-27
canonical_language: English
owner: "Playbook system owner"
primary_archetype: "Operating + Capability + Decision + Execution + Response"
rigor_level: "R4 / CRITICAL for this standard; implementation controls scale by processing risk"
volatility: "Mixed: stable engineering principles + fast/event-driven regulatory overlays"
default_review: "quarterly source-status review; annual architecture review; immediate event-driven review for material law/regulator/standard changes"
legal_status: "Not legal advice; jurisdictional applicability requires qualified legal/privacy interpretation where material"
supersedes: "PB-07-PRIVACY v1.0"
related_artifacts:
  - "Master Playbook Standard v2.0-RC1"
  - "Universal Software & AI Engineering Master Playbook v2.0"
```

> **Core doctrine:** A system does not earn the right to process personal data because it can secure it. Every material personal-data action should have a specific purpose, necessity argument, authorized context, accountable owner, bounded access, bounded lifetime, rights/deletion behavior, and evidence that the controls actually work.

---

# 1. Executive standard

Privacy engineering converts privacy principles and scoped legal duties into **system behavior**.

The durable chain is:

```text
OUTCOME / USER NEED
→ PURPOSE
→ AUTHORITY / APPLICABLE RULE
→ NECESSITY + PROPORTIONALITY
→ DATA ACTION
→ PRIVACY RISK TO PEOPLE
→ MINIMIZED ARCHITECTURE
→ ACCESS + USE BOUNDARIES
→ RETENTION + RIGHTS + DELETION
→ VERIFICATION / MONITORING
→ EVIDENCE + LEARNING
```

This standard inherits Playbook 00's risk-proportional, evidence-aware, traceable operating model `[BASE01]` and the engineering master's explicit distinction between privacy and security `[BASE02]`.

A secure system can still be privacy-invasive. NIST privacy engineering models privacy risk through problematic data actions and impact to individuals rather than reducing privacy to confidentiality `[NIST02]`. RFC 6973 likewise treats correlation, identification, secondary use, disclosure and exclusion as privacy concerns and frames minimization across collection, use, disclosure, retention and access `[IETF01]`.

## 1.1 What good looks like

For material personal-data processing, a competent reviewer can answer:

1. Why does this data exist?
2. Which exact purpose requires it?
3. What permits/requires the processing in the applicable context?
4. Why is this granularity, frequency and population necessary?
5. Who is affected and how can the processing harm them?
6. Where does the data exist, including derived, telemetry and AI copies?
7. Who can access it, for what action and purpose?
8. Which external recipients/processors can access it?
9. How long is it necessary?
10. Which rights or product controls must be executable?
11. What happens in backups, processors, vectors, analytics and models when data expires or is deleted?
12. How is compliance/control behavior verified?
13. What change triggers re-evaluation?

## 1.2 Root invariant

```text
NO UNEXPLAINED PERSONAL DATA
NO UNEXPLAINED PURPOSE
NO UNEXPLAINED ACCESS
NO UNEXPLAINED RECIPIENT
NO UNEXPLAINED RETENTION
NO UNEXPLAINED DELETION STATE
NO UNOWNED MATERIAL PRIVACY RISK
```

"Unexplained" means no current, reviewable rationale tied to actual system behavior. It does not mean every low-risk attribute requires a legal memo.

---

# 2. How to use this playbook

Use this standard to:

- design new products and services;
- review schemas, events, logs, analytics and integrations;
- define privacy requirements and acceptance criteria;
- implement data lifecycle controls;
- threat-model privacy harms;
- govern processors/vendors/subprocessors;
- engineer individual/user rights workflows;
- design AI/LLM/RAG/agent data boundaries;
- perform PIA/DPIA or equivalent high-risk analysis;
- build privacy test/evidence packages;
- audit production data behavior;
- translate applicable rules into testable engineering constraints.

Do **not** use it as:

- a substitute for jurisdiction-specific legal advice;
- a claim that GDPR applies globally;
- a certificate that a system is lawful;
- a replacement for Security Engineering;
- a static checklist that overrides contextual judgment.

Where applicable law, regulation, contract, platform rule, sector standard or other higher-authority requirement conflicts with this playbook, the scoped external requirement takes precedence `[BASE01]`.

---

# 3. Evidence model and normative language

## 3.1 Claim status

This playbook inherits Playbook 00's claim taxonomy:

| Label | Meaning |
|---|---|
| `REQ` | Scoped external requirement |
| `EST` | Well-established principle across strong sources |
| `DEF` | Recommended default |
| `CTX` | Context-dependent practice |
| `EMG` | Emerging practice / incomplete evidence |
| `HOUSE` | Deliberate internal standard |
| `EXP` | Experiment/hypothesis |
| `UNK` | Material unresolved question |

Normative terms:

- **MUST / MUST NOT** — mandatory within this house standard or explicitly scoped external requirement.
- **SHOULD / SHOULD NOT** — strong default; deviation requires a rational, reviewable reason.
- **MAY** — optional/contextual technique.
- **JUDGMENT REQUIRED** — context prevents one safe deterministic rule.

## 3.2 Evidence lanes

Use the engineering master playbook's claim-fit evidence discipline `[BASE02]`:

```text
E0  binding law / scoped contract
E1  international/formal standard
E2  systematic review / synthesis
E3  empirical research
E4  regulator/government/open-consensus framework
E5  mature operational evidence
E6  official platform/protocol semantics
E7  practitioner pattern
E8  opinion/folklore
```

A regulator can define legal interpretation within its authority; it does not prove one technical implementation is universally optimal. A PET paper can establish properties of a mechanism; it does not establish legal compliance.

## 3.3 Source-status discipline

At the evidence cutoff:

- NIST Privacy Framework **1.1 remains an Initial Public Draft**; do not cite it as final `[NIST01]`.
- ISO/IEC 27701 current published edition is **2025 Edition 2** `[ISO02]`.
- ISO/IEC 29100 current published edition is **2024 Edition 2** `[ISO01]`.
- ISO/IEC 27018 current published edition is **2025 Edition 3** `[ISO07]`.
- ISO/IEC 27555:2021 remains published but is under revision; the DIS replacement is draft `[ISO04]`.
- EDPB Guidelines 4/2019 on Article 25 are final `[EU02]`.
- EDPB Guidelines 01/2025 on pseudonymisation remain consultation/draft status at the cutoff `[EU09]`.

Draft status is evidence and MUST be preserved.

---

# 4. Scope and system boundary

## 4.1 In scope

This standard applies to personal-data processing in:

- web/mobile/desktop applications;
- APIs/services;
- databases, caches and object stores;
- events, queues and streams;
- analytics/BI/data warehouses/lakes;
- logs, metrics, traces, crash reporting and session replay;
- identity/auth/account systems;
- customer-support and operations tools;
- processors/subprocessors/integrations;
- exports and data-sharing products;
- AI/ML/LLM systems;
- RAG, embeddings and vector stores;
- agent memory and tool traces;
- model training, fine-tuning and evaluation;
- backups/archives/disaster recovery;
- system retirement.

## 4.2 Data is broader than database columns

Treat as data when material:

- directly supplied content;
- metadata;
- direct identifiers;
- indirect identifiers;
- persistent pseudonyms;
- device/network data;
- inferred attributes;
- predictions and scores;
- associations/relationships;
- behavioral events;
- location/time patterns;
- search/query history;
- support conversations;
- image/audio/video;
- biometric representations;
- document text;
- embeddings;
- memory summaries;
- model outputs about people;
- audit events;
- operational traces.

## 4.3 Privacy boundary

The privacy boundary follows **data actions and ability to affect people**, not ownership of infrastructure.

A model API, CDN, observability vendor, support platform, warehouse, backup provider or contractor can be inside the privacy system boundary even when the organization does not run it.

---

# 5. Privacy system model

## 5.1 Data Action Graph

For each material workflow, model:

```text
INDIVIDUAL / SOURCE
    ↓
COLLECT / RECEIVE / OBSERVE
    ↓
VALIDATE / TRANSFORM / PSEUDONYMIZE
    ↓
STORE / INDEX / EMBED / CACHE
    ↓
USE / ANALYZE / INFER / SCORE
    ↓
ACCESS / SUPPORT / ADMINISTER
    ↓
DISCLOSE / SHARE / EXPORT / TRAIN
    ↓
REPLICATE / BACK UP / ARCHIVE
    ↓
RECTIFY / RESTRICT / OBJECT
    ↓
DELETE / ANONYMIZE / EXPIRE
```

Branches are expected. The model exists to expose hidden actions.

## 5.2 Canonical Data Processing Contract

Every material processing activity SHOULD make this recoverable in one system or linked records:

```yaml
processing_id:
name:
owner:
product_outcome:
affected_people_or_groups: []
purpose:
secondary_purposes: []
authority_or_legal_overlay: []
jurisdictions: []
data_elements: []
derived_or_inferred_data: []
collection_source:
collection_mode:
required_vs_optional:
identifiability:
sensitivity:
volume_and_scale:
data_actions: []
systems_and_stores: []
regions_and_remote_access: []
controller_processor_roles: []
processors_and_subprocessors: []
recipients: []
access_policies: []
telemetry_copies: []
training_evaluation_use: []
retention_trigger:
retention_rule:
legal_or_incident_holds: []
deletion_workflow:
backup_behavior:
rights_supported: []
notice_and_choice_behavior:
transfer_mechanisms: []
privacy_threats: []
controls: []
tests: []
residual_risk:
risk_owner:
review_triggers: []
last_reviewed:
```

This is a `HOUSE` data contract, not an ISO/GDPR form.

## 5.3 Data element metadata

For high-risk/complex systems, each sensitive/identifying field SHOULD record:

```yaml
data_id:
semantic_definition:
source:
direct_identifier: true|false
indirect_identifier: true|false
persistent_identifier: true|false
derived_or_inferred: true|false
sensitivity:
precision:
subject_group:
purpose_links: []
allowed_consumers: []
allowed_outputs: []
retention_class:
deletion_class:
telemetry_allowed: true|false
test_data_allowed: true|false
cross_tenant_allowed: false
owner:
```

Schema metadata SHOULD become machine-enforceable where practical.

---

# 6. Golden Privacy Engineering Standards

1. **Define intended purpose before collecting, generating, inferring, purchasing, importing or exposing personal data.**
2. **Treat purpose, authority/legal basis, user choice and technical access as separate concepts.**
3. **Collect the minimum data necessary at the minimum precision, frequency, population, identifiability, retention and replication needed.**
4. **Make optional personal-data processing off by default unless the scoped context justifies another default.**
5. **Treat privacy as a lifecycle system property, not a policy page, cookie banner or final compliance review.**
6. **Treat privacy risk as risk to people caused by data actions, not merely risk of unauthorized disclosure.**
7. **Maintain an inventory sufficient to reconstruct where personal data comes from, how it changes, who accesses it, where it travels, why it exists and how it exits.**
8. **Assign an accountable owner for every material processing purpose and data store.**
9. **Represent purpose, classification and retention constraints in enforceable metadata/policy where practical.**
10. **Do not let a new feature silently inherit broad access to existing personal data.**
11. **Do not repurpose personal data merely because it is technically available.**
12. **Run a purpose-change/compatibility gate before materially new secondary use.**
13. **Treat derived attributes, predictions, scores, embeddings, profiles and inferred sensitive traits as data requiring their own purpose/risk analysis.**
14. **Treat identifiers on a spectrum; indirect, persistent, probabilistic and contextual identifiers can create linkability/identification risk.**
15. **Treat pseudonymised data as personal whenever re-identification remains reasonably possible or mapping/additional information exists.**
16. **Do not call data anonymous merely because names were removed, hashed, encrypted, tokenized or replaced by IDs.**
17. **Use contextual re-identification analysis before treating de-identified data as anonymous.**
18. **Separate pseudonymisation keys/mappings from pseudonymized datasets and protect them independently.**
19. **Prefer local/on-device processing when it materially reduces central exposure without undermining the required outcome.**
20. **Use aggregation, coarsening, sampling, query limitation or formal PETs when raw individual-level data is unnecessary.**
21. **Use differential privacy only with explicit threat model, parameters, contribution bounds, composition/accounting and utility validation.**
22. **Do not use k-anonymity or similar heuristic de-identification as automatic proof of anonymity.**
23. **Default internal access to least privilege and least data.**
24. **Authorize sensitive personal-data access by principal, action, resource and context where consequence warrants it.**
25. **Use just-in-time/time-bounded privileged access for high-sensitivity data where practical.**
26. **Log material privileged access without turning the audit trail into a second uncontrolled sensitive-data corpus.**
27. **Treat developer/support/analytics/incident-response access as production data access.**
28. **Do not routinely copy production personal data into development, test, demos or local environments.**
29. **Use synthetic/minimized test data; if real data is unavoidable, apply production-equivalent governance and short retention.**
30. **Classify logs, traces, metrics dimensions, crash reports, replay, analytics and AI/tool traces as data pipelines.**
31. **Prefer allowlisted structured telemetry fields over unrestricted object/request/body logging.**
32. **Redact/transform sensitive values before telemetry leaves the originating trust boundary where feasible.**
33. **Do not put credentials, secrets, full payment data or unnecessary sensitive content in logs.**
34. **Treat IPs, device/ad IDs, account IDs, stable pseudonyms and high-cardinality fingerprints as potentially identifying/linkable.**
35. **Define telemetry purpose, retention, access, sampling and deletion separately from primary application data.**
36. **Set a retention rule when data is introduced, not after storage growth becomes a problem.**
37. **Prefer retention triggers tied to real lifecycle events where they represent necessity better than arbitrary indefinite periods.**
38. **Automatically enforce retention where practical; manual calendars are weak controls at scale.**
39. **Treat legal/fraud/security holds as scoped exceptions with owner, authority, access restrictions and expiry/review.**
40. **Design deletion across primary stores, replicas, caches, indexes, streams, analytics, vectors, exports, processors and backups.**
41. **Define deletion states explicitly rather than using a binary `deleted=true`.**
42. **Test that deleted data does not reappear after restore, replay, reindex, backfill or cache repopulation.**
43. **Where backups cannot be selectively overwritten immediately, put erased data beyond ordinary use and re-apply deletion state before restored data becomes live.**
44. **Retain only the minimum suppression/tombstone evidence needed to honor legitimate controls.**
45. **Propagate deletion obligations to processors/subprocessors where required and retain appropriate completion evidence.**
46. **Define how derived data is handled when source data is deleted.**
47. **Do not promise model unlearning as deterministic database deletion unless the method and scope are demonstrably effective.**
48. **Build rights handling as an engineering capability: discovery, identity verification, action, propagation and evidence.**
49. **Verify requesters proportionately; do not collect excessive identity data for low-risk rights requests.**
50. **Make rights workflows cover archives, data lakes, analytics, support SaaS, vectors and material processor systems.**
51. **Design exports for the actual applicable right/product commitment; `download JSON` is neither universally required nor universally sufficient.**
52. **Track recipients/downstream disclosures sufficiently to support required restriction/deletion/notice propagation.**
53. **Treat consent as a controlled state machine where used: purpose, scope, evidence, version, withdrawal and downstream effect.**
54. **Do not use pre-ticked boxes, obstruction or manipulative choice architecture to manufacture agreement.**
55. **Make withdrawal no harder than grant where applicable and make technical consequences explicit.**
56. **Do not use consent as a universal fallback for processing that is unnecessary or otherwise inappropriate.**
57. **Treat children, health, biometric, precise location, communications, financial and other highly sensitive data as higher-assurance categories where applicable.**
58. **Do not infer sensitive traits merely because a model can; inferred sensitive data can create privacy harm.**
59. **Escalate assurance where processing materially affects eligibility, employment, credit, housing, healthcare, education, insurance or public services.**
60. **Run a PIA/DPIA or equivalent structured privacy impact assessment before likely high-risk processing or when law/policy requires it.**
61. **Start privacy threat modeling from data actions and harms to people, then add security threats.**
62. **Assess linking, identification, inference, disclosure, secondary use, surveillance, exclusion, manipulation, loss of control, overretention and non-compliance.**
63. **Treat privacy threat models as living when data sources, recipients, purposes, models or attack capabilities materially change.**
64. **Model tenant boundaries explicitly; shared infrastructure does not justify cross-tenant access.**
65. **Treat data sharing as a new trust boundary with purpose, minimization, security, retention, onward-transfer and deletion conditions.**
66. **Use processors/vendors only after roles, instructions, data, locations, subprocessors, retention, rights, deletion and exit are understood.**
67. **Do not treat a DPA/contract/certificate as technical proof that runtime privacy behavior works.**
68. **Monitor material processor/subprocessor changes.**
69. **Design vendor exit so personal data, keys, exports and derived copies can be returned/deleted with evidence.**
70. **Treat international transfer legality and data residency as different questions.**
71. **Do not infer that in-region hosting alone satisfies remote-access/onward-transfer restrictions.**
72. **Re-check transfer mechanisms/adequacy status before material deployment because legal status can change.**
73. **Encrypt personal data where appropriate, but never use encryption to justify unnecessary collection or retention.**
74. **Separate keys/access paths where cryptographic separation materially reduces re-identification or breach risk.**
75. **Use minimization, access and lifecycle controls even for encrypted data.**
76. **Treat privacy controls as product behavior with acceptance criteria, tests, owners and failure modes.**
77. **Add deterministic privacy checks to CI/CD where policy can be machine-tested.**
78. **Scan for unexpected sensitive data in telemetry/storage/dev tools when risk justifies it.**
79. **Use privacy abuse cases in verification, not only happy-path compliance checks.**
80. **Test cross-tenant/horizontal isolation independently of UI restrictions.**
81. **Test deletion end-to-end, including restore/replay paths.**
82. **Test rights completeness against the data inventory, not only the primary database.**
83. **Treat privacy incidents as broader than breaches; harmful authorized processing can be a privacy incident.**
84. **Maintain a privacy incident path that triggers legal breach assessment without assuming every incident is legally reportable.**
85. **Design incident evidence to identify data, affected people, copies, protections, timing and recipients.**
86. **Scope emergency telemetry and expire it; incident response is not an unlimited minimization exception.**
87. **Treat AI prompts, histories, embeddings, vectors, tool traces, outputs, feedback, evals, training/fine-tuning data and memory as distinct data surfaces.**
88. **Prevent model relevance from granting access; deterministic policy filters retrieval before model use.**
89. **Bind agent memory to provenance, account/tenant, sensitivity, purpose, TTL, correction and deletion.**
90. **Do not allow untrusted prompt/document content to broaden data permissions.**
91. **Require separate analysis before reusing product data for model training, fine-tuning, evaluation or research.**
92. **Record training/evaluation data provenance sufficient to assess permissions, sensitivity, restrictions and deletion feasibility.**
93. **Treat model outputs that reveal/reconstruct personal data as privacy failures even if source data is not directly exposed.**
94. **Use memorization/extraction/membership/reconstruction tests where the AI privacy threat model makes them material.**
95. **Do not assume a model is anonymous; assess identification and extractability case by case.**
96. **Gate autonomous agent disclosures, messages, exports, enrichment and deletion according to consequence and authority.**
97. **Treat analytics as a product requirement that must earn its data; "we may need it later" is not a purpose.**
98. **Measure privacy outcomes/control health, not only review completion.**
99. **Keep a canonical source for processing purpose, data classification, retention, owner and regulatory overlay where practical.**
100. **Make privacy-relevant architecture decisions traceable to requirement → risk → control → test → observed result.**
101. **Review privacy for schema changes, events, logs, vendors, regions, models, agent tools and exports.**
102. **Retire personal data and privacy dependencies deliberately when features/systems are decommissioned.**
103. **Preserve necessary accountability evidence without preserving unnecessary raw personal data.**
104. **Apply jurisdiction/sector rules as overlays; do not turn one law into a false universal engineering law.**
105. **When applicable external requirements conflict with a lower-level heuristic, the scoped higher-authority requirement wins.**
106. **Treat draft standards/guidance as watch items, not final baseline requirements.**
107. **Escalate to qualified privacy/legal specialists when applicability, legal basis, high-risk rights or transfer duties materially affect design.**
108. **Make unresolved privacy uncertainty visible; uncertainty is not permission to silently proceed.**

---

# 7. Purpose engineering

## 7.1 Purpose must constrain behavior

A useful purpose can answer:

- what outcome is enabled?;
- which data is necessary?;
- which data actions are allowed?;
- which recipients are allowed?;
- how long is data needed?;
- what new use would constitute purpose change?

Weak:

> "Analytics."

Stronger:

> "Measure weekly onboarding activation by tenant and device class so product regressions can be detected; raw event identifiers expire after the operational analysis window and long-term trend tables contain aggregated counts."

Exact duration remains contextual.

## 7.2 Purpose is not authority

```text
PURPOSE = why processing exists
AUTHORITY / LEGAL BASIS = what permits/requires it in a scoped regime
CHOICE / CONSENT = a user-control mechanism where applicable
ACCESS = which principal can technically perform an action
```

Consent does not make unnecessary collection necessary. Database access does not create purpose.

## 7.3 Purpose-change gate

```yaml
original_purpose:
proposed_purpose:
data_involved:
affected_people:
compatibility_or_new_authority_analysis:
reasonable_expectations:
new_harms_or_inferences:
minimization_options:
notice_choice_or_consent_change:
retention_change:
recipient_change:
rights_change:
decision:
decision_owner:
revisit_trigger:
```

Where GDPR applies, Article 5 purpose limitation and Article 6 lawful-processing requirements govern the legal analysis `[EU01]`. The universal engineering control is the **gate**, not one universal legal outcome.

---

# 8. Data minimization

## 8.1 Multi-dimensional minimization

| Dimension | Question | Typical control |
|---|---|---|
| Attributes | Are all fields necessary? | remove/derive-on-demand |
| Precision | Is exact value necessary? | ranges/coarsening |
| Frequency | Must collection be continuous? | event-driven/sampling |
| Population | Must all users be included? | scoped cohorts |
| Identifiability | Is direct identity necessary? | pseudonym/local token |
| Linkability | Must one ID persist across contexts? | context-specific IDs |
| Visibility | Who needs raw values? | masking/aggregation |
| Retention | How long does purpose require it? | TTL/event expiry |
| Replication | How many stores/vendors need it? | reduce copies |
| Inference | Is sensitive profiling necessary? | disable/limit feature |
| Telemetry | Is content needed to operate? | structured diagnostics |
| Training | Is product data needed? | separate/minimized/synthetic data |

GDPR explicitly includes data minimisation and storage limitation where applicable `[EU01]`. OECD principles independently support collection limitation, purpose specification and use limitation `[OECD01]`.

## 8.2 Necessity challenge

For R3/R4 processing, a field should survive:

1. What function/decision fails without it?
2. Can lower precision work?
3. Can it be computed locally and discarded?
4. Can it be aggregated?
5. Can it be collected only on trigger/error?
6. Can access be service-only rather than human?
7. Can retention be shorter?
8. Can synthetic/non-personal data substitute?

## 8.3 Dark data

Unused personal data creates:

- breach/incident scope;
- discovery/right scope;
- deletion burden;
- access surface;
- model-training temptation;
- retention cost;
- regulatory/accountability scope.

Unused data SHOULD be removed or given a current explicit purpose.

---

# 9. Privacy by design and default

## 9.1 Early design

Privacy decisions SHOULD precede hard-to-reverse choices such as:

- identifier architecture;
- shared tenant schema;
- global event bus;
- long-lived analytics lake;
- vendor/model integration;
- region topology;
- irreversible sharing;
- training corpus creation;
- biometric enrollment.

ISO 31700-1:2023 and final EDPB Article 25 guidance support lifecycle privacy-by-design thinking `[ISO06][EU02]`.

## 9.2 Protective defaults

Common defaults:

- optional tracking disabled until valid activation where required;
- minimum audience/recipient scope;
- no public discoverability unless product intent requires it;
- minimum telemetry;
- no secondary model training reuse without separate decision;
- limited conversation/session history;
- expiry for temporary uploads and agent memory.

Another default MAY be justified, but the reason SHOULD be explicit and testable.

## 9.3 Progressive disclosure

Ask for data when it becomes necessary rather than collecting everything at onboarding.

---

# 10. Classification, sensitivity and inference

## 10.1 Do not use one global "PII" bucket

A useful `HOUSE` model distinguishes:

```text
NON-PERSONAL / PUBLIC
POTENTIALLY PERSONAL / LINKABLE
PERSONAL
SENSITIVE
HIGHLY SENSITIVE / HIGH-CONSEQUENCE
REGULATED SPECIAL CATEGORY / DOMAIN-SPECIFIC
```

Legal definitions remain jurisdictional.

## 10.2 Escalation factors

- direct identification;
- persistent cross-context identifiers;
- unique combinations;
- credentials/secrets;
- precise location;
- communications content;
- health/genetic/biometric;
- financial/payment;
- children/vulnerable groups;
- employment/education;
- political/religious beliefs;
- sexual life/orientation;
- ethnicity/race where regulated;
- criminal/legal matters;
- consequential profile/score;
- inferred sensitive attributes;
- scale and duration.

## 10.3 Inferences are first-class

If a system predicts pregnancy, health, politics, creditworthiness, fraud, employment suitability or another sensitive/consequential trait, the privacy risk exists even if the user never supplied that value directly.

---

# 11. Identity, pseudonymisation and anonymity

## 11.1 Identity is contextual

A record may identify without a name through:

- unique IDs;
- stable pseudonyms;
- demographic combinations;
- rare attributes;
- timestamps/location;
- device/network identifiers;
- behavior;
- graph relationships;
- external datasets;
- operator access to mapping data.

## 11.2 Pseudonymisation

Useful for reducing routine exposure, but should be designed as a system:

```text
PSEUDONYMIZED DATA
+ SEPARATE MAPPING / KEY
+ INDEPENDENT ACCESS CONTROL
+ ROTATION / REVOCATION WHERE RELEVANT
+ RE-IDENTIFICATION POLICY
+ AUDIT
```

ICO guidance treats pseudonymisation as risk reduction that still requires analysis of insider/external re-identification and protection of additional information `[UK03]`. EDPB Guidelines 01/2025 are still draft/watch `[EU09]`.

## 11.3 Hashing

Hashing is not automatically anonymisation.

Risk rises when:

- input domain is guessable;
- same hash is reused across contexts;
- deterministic hashes enable linkage;
- attacker has dictionaries/reference lists;
- original value is easy to validate.

Use keyed pseudonymisation/tokenization/context-specific identifiers when controlled linkability is the goal.

## 11.4 Anonymisation

Anonymisation is a conclusion about **identifiability in context**, not a transformation label.

Assess:

- singling out;
- linkability;
- inference;
- uniqueness;
- auxiliary datasets;
- recipient capability;
- legal access to additional information;
- motivated intruder;
- future data/tooling.

ISO/IEC 27559 focuses on re-identification risk through the lifecycle of de-identified data `[ISO05]`. ICO guidance treats identifiability as a spectrum and requires context-specific assessment `[UK03]`.

Anonymity claims SHOULD have a review trigger.

---

# 12. Privacy-enhancing technologies

PETs are mechanisms, not compliance certificates.

| Mechanism | Strong use | Does not solve |
|---|---|---|
| Pseudonymisation/tokenization | reduce routine identity exposure | purpose, necessity, key-holder re-identification |
| Encryption | confidentiality against defined access paths | overcollection, authorized misuse |
| Aggregation/coarsening | reduce individual granularity | all inference/re-identification |
| Local/on-device processing | reduce central exposure | local compromise/downstream output |
| Differential privacy | formal privacy bound for certain analyses/releases | raw-data governance |
| MPC/secure computation | cross-party computation with reduced raw disclosure | purpose/output governance |
| Trusted execution | isolate processing environment | output misuse/purpose |
| Synthetic data | reduce direct raw-data use | memorization or generator leakage |
| Context-specific IDs | reduce cross-context linkage | within-context profiling |

## 12.1 Differential privacy record

```yaml
adjacency_definition:
mechanism:
epsilon:
delta:
contribution_bounds:
composition_accounting:
privacy_budget_owner:
release_frequency:
population_size:
utility_target:
attack_model:
implementation:
validation:
```

NIST SP 800-226 is current technical guidance for evaluating differential privacy guarantees `[NIST03]`.

---

# 13. Access and internal use

## 13.1 Access model

```text
WHO/WHAT PRINCIPAL
× ACTION
× DATA / RESOURCE
× PURPOSE / CONTEXT
× TENANT / SUBJECT
× ENVIRONMENT
× TIME
× APPROVAL STATE
```

RBAC may be adequate in simple systems. ABAC/policy engines add expressiveness but also complexity.

## 13.2 Human access

Proportionate high-sensitivity controls:

- named identity;
- strong authentication;
- role/attribute restriction;
- just-in-time grants;
- expiration;
- approval;
- query/field masking;
- audit;
- break-glass evidence;
- recertification.

## 13.3 Machine and agent access

Machine identities MUST be scoped. An agent cannot receive tenant-wide private data merely because "the model may need context."

## 13.4 Support access

Support tools SHOULD provide:

- minimum fields;
- redacted sensitive fields by default;
- ticket/purpose context;
- audited elevation;
- explicit tenant/user selection;
- no broad cross-customer search without separate authorization.

---

# 14. Telemetry, observability and privacy

## 14.1 Telemetry is a separate data product

Inventory:

- application logs;
- events;
- traces/spans;
- metrics dimensions;
- APM;
- crash dumps;
- browser/mobile diagnostics;
- session replay;
- product analytics;
- experiments;
- support/recording;
- SIEM/security logs;
- AI prompts/tool traces/model logs.

## 14.2 Telemetry Data Contract

```yaml
event_name:
operational_question:
producer:
fields:
  - name:
    purpose:
    personal_data_class:
    transformation:
sampling:
retention:
access_roles:
processor:
region:
deletion_linkage:
rights_linkage:
owner:
```

## 14.3 Safe defaults

MUST NOT log by default:

- passwords;
- tokens/API keys/session secrets;
- private encryption keys;
- full auth headers;
- full payment-card secrets;
- unrelated highly sensitive content.

SHOULD avoid by default:

- raw bodies;
- free-form content;
- exact location;
- unredacted email/phone;
- persistent cross-context identifiers.

## 14.4 Allowlist over denylist

```text
STRUCTURED EVENT SCHEMA
→ ALLOWLIST
→ TRANSFORM / REDACT
→ VALIDATE
→ EXPORT
```

Denylist redaction is brittle as schemas evolve.

## 14.5 Emergency diagnostic capture

If severe incidents require more detail, use:

- named purpose/incident;
- owner/approval;
- narrow cohort;
- automatic expiry;
- restricted access;
- post-incident deletion/review.

Emergency mode MUST NOT become permanent observability.

---

# 15. Retention engineering

## 15.1 Retention state machine

```text
ACTIVE
→ INACTIVE / CLOSED
→ RETENTION WINDOW
→ DELETE_PENDING
→ LIVE_DELETED
→ BACKUP_ONLY_BEYOND_USE
→ EXPIRED / DESTROYED
```

Optional branches:

```text
ACTIVE → LEGAL/INCIDENT HOLD → REVIEW → RETURN TO LIFECYCLE
ACTIVE → ANONYMIZED (only if the identifiability conclusion is justified)
```

## 15.2 Retention rule

```yaml
data_or_store:
purpose:
retention_trigger:
retention_duration_or_event:
minimum_required_by:
maximum_allowed_by:
hold_conditions:
archive_allowed:
archive_access:
backup_expiry:
deletion_method:
owner:
evidence:
review_trigger:
```

## 15.3 Event-based retention

Examples:

- account closure + justified period;
- invoice settlement + statutory period;
- incident closure + investigation period;
- ticket closure + service-quality period;
- experiment end + analysis period.

Avoid arbitrary "forever."

## 15.4 Holds

A hold MUST be scoped, authorized, restricted, auditable, reviewable and explicitly released. It SHOULD stop deletion only for data actually required.

---

# 16. Deletion and erasure engineering

## 16.1 Deletion graph

```text
PRIMARY DB
├─ replicas
├─ cache
├─ search
├─ object storage
├─ uploaded files
├─ event log / stream
├─ queues / DLQ
├─ warehouse / lake
├─ analytics
├─ support / CRM
├─ telemetry
├─ exports
├─ vectors / embeddings
├─ agent memory
├─ training/eval datasets
├─ processors/subprocessors
└─ backups / snapshots
```

Each node needs a policy even if the action differs.

## 16.2 Deletion operation object

```yaml
deletion_id:
subject_or_scope:
trigger:
authority:
requested_at:
stores:
  - store_id:
    action:
    status:
    evidence:
processors:
  - processor:
    request_status:
backup_state:
derived_data_state:
model_state:
tombstone_or_suppression_record:
completed_at:
failures:
risk_owner:
```

## 16.3 Idempotency

Deletion SHOULD be retry-safe. One failed processor/store MUST NOT allow global success to be falsely reported.

## 16.4 Backups

A technically sound design may:

1. erase live data;
2. put backup copies beyond ordinary use;
3. expire/overwrite backups on a controlled schedule;
4. replay deletion/tombstone state before restored data becomes production-readable.

ICO guidance recognizes this beyond-use pattern for backups under its erasure guidance `[UK02]`.

This is not a universal legal exception. Applicable law/system constraints govern.

## 16.5 Restore invariant

> **Disaster recovery MUST NOT resurrect data that the production system validly deleted unless a narrowly authorized preservation rule applies.**

Test:

```text
DELETE SUBJECT
→ RESTORE PRE-DELETION BACKUP IN ISOLATION
→ APPLY DELETION LEDGER / TOMBSTONES
→ RECONCILE
→ VERIFY SUBJECT DATA IS NOT REINTRODUCED
→ AUTHORIZE CUTOVER
```

## 16.6 Derived data

Classify:

- reversible direct derivation;
- pseudonymized mapping;
- aggregate;
- statistical model;
- embedding/vector;
- profile/score;
- human-authored note;
- model weights/adapters.

Define rights/deletion impact separately. Source erasure does not automatically establish that every downstream artifact is non-personal or unaffected.

---

# 17. Rights and user-control engineering

## 17.1 Orchestration

```text
REQUEST
→ IDENTITY / AUTHORITY CHECK
→ SCOPE RESOLUTION
→ DATA DISCOVERY
→ EXEMPTION / CONSTRAINT REVIEW
→ ACTION
→ DOWNSTREAM PROPAGATION
→ QUALITY CHECK
→ RESPONSE
→ EVIDENCE + EXPIRY
```

## 17.2 Identity verification

Verification SHOULD be proportionate to:

- sensitivity;
- current authentication;
- impersonation risk;
- available identifiers;
- risk of creating new identity data.

Do not collect a passport for a low-risk authenticated request when existing authentication is sufficient.

## 17.3 Inventory-driven discovery

Rights workflows must not be hard-coded only to primary databases. Inventory processor APIs, archives, analytics, vectors and backup policies.

## 17.4 Portability

Where an applicable right requires structured, commonly used, machine-readable portability, engineer the export accordingly `[EU01]`. Do not universalize the exact scope.

## 17.5 Consent / preference state

Where consent or preference is used:

```yaml
preference_id:
subject:
purpose:
scope:
choice:
version:
notice_version:
granted_at:
withdrawn_at:
source:
evidence:
downstream_effects:
reconsent_trigger:
```

Avoid a single global boolean if purposes/channels/recipients differ.

---

# 18. Fairness, transparency and deceptive design

## 18.1 Transparency is behavior fidelity

User-facing explanation SHOULD match:

- actual purpose;
- actual data fields;
- actual recipients;
- actual retention;
- actual AI use;
- actual user controls;
- actual consequences of optional/required processing.

## 18.2 Choice architecture

Do not make privacy-protective choices:

- visually hidden;
- materially slower;
- confusingly worded;
- repeatedly nagged after refusal;
- bundled with unrelated processing without justification;
- reversible only through support while acceptance is one click.

EDPB final guidance on deceptive design patterns supports treating UX as part of data-protection behavior `[EU05]`.

## 18.3 Required versus optional

Interfaces SHOULD distinguish:

- data necessary for requested core function;
- data required by scoped law/contract;
- optional personalization;
- optional analytics;
- optional advertising;
- optional training/research.

This prevents purpose laundering.

---

# 19. Processor, vendor and subprocessor engineering

## 19.1 Vendor Privacy Contract

```yaml
vendor:
service:
role:
processing_purposes:
data_categories:
subject_groups:
regions:
remote_support_regions:
subprocessors:
customer_instructions:
security_controls:
privacy_controls:
retention:
deletion_return:
backup_behavior:
rights_support:
incident_notification:
audit_evidence:
transfer_mechanism:
training_or_service_improvement_use:
termination_exit:
owner:
review_trigger:
```

## 19.2 Due diligence

Do not stop at SOC/ISO badges, a DPA, or a procurement questionnaire. Ask:

- Can the vendor technically restrict support access?
- Can data and backups be region-scoped?
- Does "no training" include prompts, content, safety logs, evaluation data and service-improvement telemetry?
- What metadata persists after content deletion?
- What is the backup expiry model?
- Which subprocessors receive content versus metadata?
- How are subprocessors changed and notified?
- Can rights/deletion be executed via API?
- What happens after account termination?
- Can data be exported in a usable format?
- Can customer-managed keys materially improve separation?
- What incident evidence is available?
- Can administrator access be audited?

For GDPR-scoped processing, Article 28 and final EDPB controller/processor guidance provide legal-role requirements `[EU01][EU03]`. The universal engineering standard is to verify that claimed responsibilities can actually be executed.

## 19.3 Vendor exit test

For high-risk processors, periodically or before termination verify:

- export works;
- deletion/return can be initiated;
- service accounts/API keys can be revoked;
- subprocessor obligations are covered;
- backup expiry is documented;
- ordinary product/support access ceases;
- retained legal/accounting records are separately justified.

A signed deletion certificate MAY be evidence; it is not the only possible evidence and it is not proof of perfect physical erasure.

---

# 20. Cross-border, residency and jurisdiction

## 20.1 Separate five questions

```text
1. WHERE is data stored?
2. WHERE can data be remotely accessed?
3. WHICH legal entity controls/processes it?
4. WHICH onward recipients/subprocessors receive it?
5. WHICH legal/transfer mechanism applies?
```

"EU region" answers only part of question 1.

## 20.2 Transfer record

```yaml
flow:
source_jurisdiction:
destination_jurisdiction:
remote_access_locations:
controller_processor_roles:
mechanism:
adequacy_or_equivalent_status_checked_at:
supplementary_measures:
subprocessors:
data_minimization:
encryption_and_key_control:
residual_access_risk:
legal_reviewer:
revisit_triggers:
```

For GDPR-scoped transfers, use current Commission/EDPB sources for SCCs, adequacy and supplementary measures rather than stale internal notes `[EU06][EU07][EU08]`.

## 20.3 Revisit triggers

Reassess when:

- vendor region changes;
- subprocessor changes;
- adequacy/transfer mechanism status changes;
- support operations move;
- remote access is introduced;
- key control changes;
- purpose/sensitivity changes;
- a court/regulator decision changes the risk/legal baseline.

---

# 21. Privacy threat modeling

## 21.1 Security threat models are incomplete for privacy

Security typically asks whether unauthorized actors can compromise systems/data.

Privacy additionally asks whether an **authorized or designed data action** can create a problem for people.

Use NIST's privacy-risk/problematic-data-action framing `[NIST02]` and a structured privacy-threat method such as RFC 6973 and/or LINDDUN `[IETF01][LIND01]`.

## 21.2 Threat families

| Threat | Example |
|---|---|
| Linking/correlation | same pseudonym connects health and employment contexts |
| Identification | de-identified records matched to public data |
| Detection | membership in a dataset reveals a condition/status |
| Inference | normal behavior predicts a sensitive trait |
| Disclosure | data reaches an undesired/unauthorized recipient |
| Secondary use | support transcript reused for model training |
| Surveillance | continuous monitoring exceeds service need |
| Unawareness | hidden processing prevents meaningful control |
| Exclusion | user loses benefit/opportunity through opaque processing |
| Manipulation | interface pressures user into broader collection |
| Overretention | stale data remains after purpose ends |
| Overaccess | staff/service can query unnecessary records |
| Cross-context identity | identifier joins unrelated products |
| Non-repudiation | permanent evidence exists where deniability matters |
| Deletion failure | restore reintroduces data |
| Vendor drift | subprocessor changes data use/location |
| AI extraction | model/vector reveals source/training data |
| Agent overreach | agent shares, enriches or deletes beyond authority |

## 21.3 Privacy abuse case

```yaml
scenario:
affected_people:
data_actions:
actor_or_system:
intended_behavior:
problematic_behavior:
privacy_harm:
preconditions:
likelihood_context:
impact_context:
controls:
detection:
recovery:
test:
residual_risk:
```

## 21.4 Risk model

Avoid fake precision. A useful qualitative prompt:

```text
LIKELIHOOD OF PROBLEMATIC DATA ACTION
× IMPACT ON PEOPLE
× SCALE
× SENSITIVITY
× PERSISTENCE
× LINKABILITY
× POWER ASYMMETRY / VULNERABILITY
÷ (DETECTABILITY × REVERSIBILITY × USER CONTROL)
```

This is not literal arithmetic.

---

# 22. PIA / DPIA / high-risk assessment

## 22.1 Trigger

Perform a formal PIA/DPIA or equivalent when:

- law/policy requires it;
- new technology creates material uncertainty;
- processing is likely high risk;
- large-scale/sensitive data is introduced;
- systematic monitoring/profiling expands;
- children/vulnerable people are materially affected;
- consequential automated decisions occur;
- cross-context linking expands;
- biometrics/precise-location use expands;
- model training/inference is difficult to reverse;
- data sharing/transfer materially broadens.

GDPR Article 35 requires a DPIA for likely high-risk processing where GDPR applies `[EU01]`. ISO/IEC 29134:2023 is a general PIA-process reference `[ISO03]`.

## 22.2 Assessment object

```yaml
assessment_id:
processing:
purpose_and_outcome:
scope_and_scale:
people_affected:
data_actions:
systems_vendors_regions:
necessity_proportionality:
alternatives:
privacy_threats:
legal_regulatory_requirements:
user_expectations_and_controls:
measures:
test_evidence:
residual_risk:
consultation_required:
approval:
monitoring:
revisit_triggers:
```

## 22.3 Assessment is not a waiver

A completed DPIA/PIA does not legalize or justify an unacceptable design. If residual risk remains unacceptable under the applicable governance model, narrow, redesign, obtain required consultation/approval, or do not launch.

---

# 23. Children, vulnerable people and highly sensitive data

## 23.1 Higher assurance

Increase control depth with:

- age/vulnerability;
- power imbalance;
- inability to understand/control processing;
- sensitivity;
- permanence;
- consequence of disclosure/inference;
- commercial manipulation risk;
- consequential automated use.

## 23.2 Age assurance is itself processing

If age must be verified/estimated:

- collect minimum evidence;
- prefer an age-band/verified claim over retaining identity documents when sufficient;
- isolate age-verification provider data;
- define retention/deletion;
- prevent secondary reuse;
- evaluate false-positive/false-negative harm.

COPPA and other child-specific regimes can impose additional consent, minimization, retention and deletion requirements `[US02]`. GDPR has child-specific rules in scoped contexts `[EU01]`. Applicability must be assessed per product/jurisdiction.

## 23.3 High-sensitivity default posture

Prefer, unless purpose/law requires otherwise:

- no unrelated advertising use;
- no broad support access;
- stronger tenant separation;
- shorter retention;
- narrower telemetry;
- explicit export/share authorization;
- higher-assurance tests;
- separate cryptographic/access domains when valuable.

---

# 24. AI / ML / LLM privacy engineering

## 24.1 AI Data Surface Inventory

Inventory separately:

```text
TRAINING CORPUS
FINE-TUNING DATA
EVALUATION / RED-TEAM DATA
PROMPTS / USER INPUT
SYSTEM CONTEXT
RETRIEVAL DOCUMENTS
EMBEDDINGS / VECTOR INDEX
CONVERSATION HISTORY
AGENT MEMORY
TOOL INPUTS / OUTPUTS
MODEL OUTPUTS / INFERENCES
FEEDBACK / RATINGS
ABUSE / SAFETY LOGS
PROVIDER TELEMETRY
CACHES
MODEL WEIGHTS / ADAPTERS
```

These surfaces may have different owners, processors, purposes, retention and deletion semantics.

## 24.2 Training/evaluation reuse gate

Product/service data MUST NOT silently become model-training/evaluation data.

```yaml
source_purpose:
proposed_training_or_eval_purpose:
data_scope:
authority_or_legal_overlay:
notice_and_choice:
sensitivity:
minimization:
de_identification:
provider_role:
retention:
provenance:
rights_impact:
deletion_or_unlearning_feasibility:
memorization_extraction_test:
decision:
```

## 24.3 Model anonymity

EDPB Opinion 28/2024 states, in the GDPR context, that whether an AI model is anonymous requires case-by-case assessment including likelihood of identifying training individuals and extracting personal data from the model `[EU11]`.

Engineering rule:

> **Do not treat model weights as categorically personal or categorically anonymous. Assess the actual identification/extraction risk and apply the scoped legal standard.**

## 24.4 RAG

Required invariant:

```text
USER / AGENT IDENTITY
→ DETERMINISTIC AUTHORIZATION FILTER
→ ELIGIBLE DOCUMENT SET
→ RETRIEVAL / RANKING
→ MODEL CONTEXT
```

Forbidden architecture:

```text
GLOBAL PRIVATE VECTOR SEARCH
→ MODEL DECIDES WHAT THE USER SHOULD SEE
```

Similarity is not authorization.

## 24.5 Embeddings/vector stores

Classify embeddings by:

- source data;
- reconstruction risk;
- semantic inference;
- stable linkability;
- tenant mixing;
- retrieval exposure;
- retention.

Source deletion SHOULD trigger defined vector/index deletion or invalidation.

## 24.6 Agent memory

```yaml
memory_id:
subject_or_tenant:
source_provenance:
content_class:
sensitivity:
purpose:
created_at:
last_used_at:
ttl:
correction_path:
deletion_path:
sharing_scope:
tool_access_scope:
owner:
```

Do not store every conversation detail "for personalization."

## 24.7 Model unlearning

`EMG / JUDGMENT REQUIRED`

Model unlearning can be useful but is not treated here as deterministic row deletion.

Before claiming unlearning satisfies a required deletion outcome, demonstrate:

- what artifact/version changes;
- what information is targeted;
- threat model;
- effectiveness test;
- residual extraction/membership risk;
- whether retraining/checkpoint replacement is required;
- provider evidence/limitations.

## 24.8 AI privacy testing

Select by threat:

- canary strings / memorization tests;
- extraction attempts;
- membership-inference methods where appropriate;
- sensitive-attribute inference;
- cross-tenant RAG leakage;
- prompt injection for exfiltration;
- tool authorization;
- memory cross-account/poisoning tests;
- provider retention/config validation;
- output logging review.

---

# 25. Agentic systems and privacy

## 25.1 Capability × privacy consequence

Escalate controls as agents can:

```text
READ PUBLIC
→ READ PRIVATE
→ LINK SOURCES
→ INFER SENSITIVE TRAITS
→ EXPORT / MESSAGE
→ WRITE RECORDS
→ CHANGE PREFERENCES
→ DELETE
→ GRANT ACCESS
```

## 25.2 Authorization outside the model

The model MAY propose a data action. Deterministic policy MUST authorize material actions `[BASE02]`.

## 25.3 Provenance

Material agent actions using personal data SHOULD preserve enough provenance to reconstruct:

- user request;
- source data;
- retrieved documents;
- memory used;
- policy version;
- tool calls;
- disclosures/writes/deletions;
- approvals;
- resulting state.

The audit trail must itself be minimized and retained purposefully.

---

# 26. Security controls that support privacy

Privacy and security overlap but are distinct.

Privacy-relevant security controls include:

- authentication;
- authorization;
- tenant isolation;
- encryption;
- key/secret management;
- secure SDLC;
- vulnerability management;
- incident detection;
- controlled audit logs;
- backup integrity;
- secure deletion mechanisms;
- endpoint/device protection.

GDPR Article 32, where applicable, includes pseudonymisation/encryption, resilience/restoration and regular testing as examples of appropriate measures `[EU01]`.

General implementation depth belongs in `06 — Security Engineering`.

---

# 27. ePrivacy / terminal-data / communications overlay

In EU/EEA contexts, national implementation of the ePrivacy Directive can impose constraints beyond GDPR on terminal storage/access and communications data `[EU10]`.

Engineering implications:

- cookie/local-storage/device SDK design needs a separate necessity/consent classification;
- "anonymous analytics" can still involve regulated terminal access before anonymisation;
- strictly necessary access/storage must be scoped to the requested service;
- consent state must control actual SDK/event execution, not only UI labels;
- moving processing server-side does not automatically eliminate personal-data obligations.

Future reform proposals are watch items until legally effective.

---

# 28. Data sharing and APIs

Before exposing personal data through APIs/data products:

- define recipient purpose;
- authenticate/authorize recipient;
- minimize fields;
- rate/bound extraction;
- enforce tenant/subject scope;
- prevent ID enumeration;
- define retention/use restrictions;
- log material disclosures;
- support revocation/termination;
- version schemas without silently adding personal fields;
- assess onward sharing.

"Internal API" is not a privacy trust guarantee.

---

# 29. Multi-tenancy

## 29.1 Tenant isolation invariant

> Data from tenant A MUST NOT be returned, logged, embedded, exported, searched, restored into, or exposed to tenant B scope except under an explicitly authorized cross-tenant product function.

Test:

- horizontal/IDOR authorization;
- vector/search indexes;
- caches;
- analytics dashboards;
- support tools;
- feature flags;
- background jobs;
- exports;
- shared LLM context/memory;
- logs/traces.

## 29.2 Shared operations

Operational cross-tenant capability MAY exist, but it SHOULD be privileged, audited, purpose-bound and minimized.

---

# 30. Development, test and non-production data

## 30.1 Default

Do not use production personal data in dev/test/demo by default.

Prefer:

- synthetic data;
- generated fixtures;
- production-shape schemas without real content;
- validated de-identified samples;
- narrow/time-limited secure production debugging.

## 30.2 Real-data exception

If real data is unavoidable:

- explicit purpose/approval;
- minimum sample;
- production-equivalent access;
- avoid laptop persistence;
- short TTL;
- disable unapproved external analytics/AI integrations;
- delete with evidence.

---

# 31. Privacy requirements in the SDLC

## 31.1 Requirements

Material features SHOULD specify:

- purpose;
- data classes;
- minimum fields;
- access;
- retention;
- rights;
- deletion;
- telemetry;
- processors/transfers;
- notice/choice;
- privacy failure modes.

## 31.2 Architecture review

Review:

- Data Action Graph;
- identity;
- tenant boundary;
- replication;
- event retention;
- cache/index;
- observability;
- processor boundary;
- AI surfaces;
- deletion/restore.

## 31.3 Change triggers

Privacy-sensitive change triggers include:

- new column/property;
- increased precision;
- new event/log field;
- new processor/SDK;
- new region;
- new export;
- new model/provider;
- new agent tool;
- changed default;
- longer retention;
- new identity linkage;
- new derived sensitive feature.

## 31.4 Release evidence

Privacy evidence SHOULD correspond to the exact artifact/configuration deployed where practical.

---

# 32. Privacy verification and testing

## 32.1 Verification matrix

| Risk / claim | Candidate evidence |
|---|---|
| field is minimized | schema/design review + necessity record |
| tenant isolation | integration/security tests |
| telemetry redaction | unit/property tests + production sample scan |
| retention | time/event integration test |
| deletion | end-to-end deletion + reconciliation |
| backup deletion safety | restore/replay drill |
| rights completeness | inventory-driven query test |
| mapping separation | access-control/architecture test |
| anonymisation | re-identification analysis/test |
| processor deletion | API/attestation/exit test |
| RAG privacy | auth-before-retrieval tests |
| model extraction | adversarial privacy eval |
| consent/choice | UI + state-machine + downstream execution test |
| transfer control | config/vendor evidence + current legal overlay |

## 32.2 Policy-as-code candidates

Automate when deterministic:

- forbidden sensitive fields in log schemas;
- required classification metadata;
- prohibited cross-tenant access;
- retention metadata presence;
- vendor/region allowlist;
- secondary-use/training flag;
- user-choice enforcement;
- export field allowlist.

Automation is evidence, not legal interpretation.

## 32.3 Synthetic canaries

Where safe, synthetic canary values can detect:

- log leakage;
- unexpected propagation;
- vendor capture;
- data-lake shadow copies.

Canaries MUST NOT be real user data.

## 32.4 Deletion regression suite

Test:

1. normal deletion;
2. retry after partial failure;
3. processor failure;
4. cache/search invalidation;
5. delayed event/replay;
6. restore from pre-deletion backup;
7. vector/index deletion;
8. legal-hold exception;
9. duplicate deletion request;
10. deletion concurrent with writes.

---

# 33. Privacy incidents and personal-data breaches

## 33.1 Privacy incident taxonomy

A privacy incident can be:

- unauthorized disclosure/access;
- purpose violation;
- excessive collection;
- excessive retention;
- rights failure;
- deletion failure;
- misleading/deceptive choice;
- harmful inference/profiling;
- cross-tenant exposure;
- processor misuse;
- unexpected international access;
- model/RAG/agent leakage;
- re-identification of released data.

A legally defined personal-data breach is a subset in some regimes. Do not use the terms as exact synonyms.

## 33.2 Response loop

```text
DETECT
→ STOP / CONTAIN PROBLEMATIC DATA ACTION
→ PRESERVE MINIMUM NECESSARY EVIDENCE
→ IDENTIFY PEOPLE / DATA / FLOWS
→ ASSESS HARM + LEGAL NOTIFICATION
→ NOTIFY / COMMUNICATE AS REQUIRED
→ REMEDIATE
→ VERIFY
→ LEARN / CHANGE SYSTEM
```

## 33.3 GDPR overlay

Where GDPR applies, Articles 33–34 define supervisory/data-subject notification duties depending on risk and circumstances `[EU01]`. Engineering must produce reliable scope/timing/protection evidence; qualified legal/privacy review owns the legal determination.

---

# 34. Metrics and privacy observability

## 34.1 Control-health metrics

Candidate metrics:

- % material data elements with owner/purpose/retention;
- % processing with current flow map;
- orphan stores/events without processing ID;
- unexpected sensitive-data telemetry detections;
- privileged-access anomalies;
- records older than retention policy;
- deletion completion latency;
- deletion failure/retry rate;
- deletion resurrection defects;
- rights-discovery completeness;
- processor deletion SLA failures;
- stale subprocessor/region records;
- current DPIA coverage for triggered processing;
- unresolved high privacy risks;
- incidents by mechanism;
- time to containment;
- re-identification test findings;
- agent/RAG cross-scope leakage findings.

## 34.2 Avoid vanity metrics

Do not use alone:

- privacy-training count;
- DPIA count;
- consent-record count;
- vendor-review count;
- deletion-record volume;
- "zero breaches" without detection evidence.

## 34.3 Metric integrity

```yaml
question:
decision:
population:
source:
privacy_risk_of_metric_itself:
owner:
threshold:
gaming_risk:
review_cadence:
```

Privacy monitoring must itself be privacy-engineered.

---

# 35. Governance

## 35.1 Roles

For material processing:

- processing/product owner;
- engineering owner;
- privacy/legal reviewer where required;
- security owner;
- data/platform owner;
- processor/vendor owner;
- risk acceptance owner;
- DPO/privacy office where applicable.

## 35.2 Decision rights

Engineering MUST NOT be forced to invent legal conclusions. Legal/privacy MUST NOT approve controls that have not been technically demonstrated.

```text
LEGAL / PRIVACY → scoped interpretation and legal positions
PRODUCT → outcome / user value
ENGINEERING → enforceable behavior
SECURITY → security control/threat evidence
DATA → lineage / quality / lifecycle
RISK OWNER → residual-risk acceptance
```

## 35.3 Exception record

```yaml
rule:
exception:
scope:
reason:
privacy_risk:
affected_people:
compensating_controls:
owner:
approved_by:
start:
expires:
review_trigger:
```

Permanent invisible exceptions are defects.

---

# 36. Regulatory engineering overlay model

This playbook is jurisdiction-neutral at its core. Laws/regulations attach as overlays.

## 36.1 Overlay object

```yaml
overlay_id:
jurisdiction_or_sector:
authority:
applies_to:
requirements:
  - requirement_id:
    engineering_implication:
    control:
    test_or_evidence:
conditions_or_exceptions:
effective_dates:
owner:
last_verified:
review_trigger:
source:
```

## 36.2 EU / EEA example

Where GDPR applies, consider as relevant:

- Article 5 principles;
- Article 6 lawful processing;
- Article 7 consent where relied upon;
- Articles 8–10 child/special/criminal data;
- Articles 12–22 rights/automated decisions;
- Article 25 design/default;
- Articles 28–30 processors/records;
- Article 32 security;
- Articles 33–34 breaches;
- Article 35 DPIA;
- Articles 37+ DPO/governance;
- Chapter V transfers `[EU01]`.

ePrivacy/national communications rules can add terminal/device and communications constraints `[EU10]`.

## 36.3 UK example

UK rules and ICO guidance evolve after the Data (Use and Access) Act 2025. Some ICO guidance is explicitly under review `[UK01][UK03]`. Maintain a UK-specific overlay rather than copying EU conclusions.

## 36.4 California example

CPPA finalized its 2025 regulation package effective 1 January 2026 with staged compliance for some cybersecurity-audit, risk-assessment and ADMT requirements `[US01]`. Applicability/deadlines must be checked at release.

## 36.5 US children example

COPPA and its 2025 amendments add child-specific parental-control, minimization, retention and third-party advertising restrictions for covered operators `[US02]`. Do not generalize COPPA's scope globally.

## 36.6 US health example

HIPAA creates sector/entity/data-specific duties where applicable `[US03]`. Health-related text in an ordinary SaaS does not automatically determine HIPAA applicability.

## 36.7 AI Act example

EU AI Act duties such as Article 50 transparency have their own scope/timeline `[EU12]`. They do not replace GDPR/ePrivacy.

---

# 37. Core decision frameworks

## 37.1 Should we collect this field?

```text
Does a defined outcome require it?
  ├─ NO → do not collect
  └─ YES
      ↓
Can less precision / identity / frequency work?
  ├─ YES → use minimized alternative
  └─ NO
      ↓
Is processing authorized/allowed in applicable overlays?
  ├─ NO / UNCLEAR → block or escalate
  └─ YES
      ↓
Define access + retention + deletion + rights + telemetry
      ↓
Implement + verify
```

## 37.2 Can we reuse existing data?

```text
Is new use within documented purpose?
  ├─ YES → re-check scope/necessity
  └─ NO / MATERIAL CHANGE
      ↓
Purpose compatibility / new authority analysis
      ↓
Can data be minimized / anonymized / aggregated?
      ↓
Does notice/choice/consent/contract need change?
      ↓
APPROVE / NARROW / NEW COLLECTION / BLOCK
```

## 37.3 Can we call this anonymous?

```text
Can a party reasonably identify, single out, link or infer a person?
  ├─ YES / MATERIAL UNCERTAINTY → treat as personal/de-identified
  └─ VERY UNLIKELY IN CONTEXT
      ↓
Have auxiliary data and recipient capability been assessed?
  ├─ NO → incomplete
  └─ YES
      ↓
Document basis + release controls + review trigger
```

## 37.4 Do we need raw content in logs?

```text
What operational question requires raw content?
  ├─ NONE → do not log it
  └─ SPECIFIC
      ↓
Can metadata / error code / hash / sampling answer it?
  ├─ YES → minimized telemetry
  └─ NO
      ↓
Can capture be scoped + short-lived + restricted + redacted?
  ├─ YES → controlled diagnostic mode
  └─ NO → redesign diagnostics
```

## 37.5 Delete, archive, hold or anonymize?

Evaluate:

1. Is purpose over?
2. Is a scoped retention/hold rule active?
3. Can data be safely anonymized for a separate purpose?
4. Can live deletion occur immediately?
5. What backup/processor/derived states remain?
6. What evidence proves the end state?
7. What restore path prevents resurrection?

---

# 38. Atomic Plays

## PRIV-01 — Launch or materially change personal-data processing

**Use when:** A new feature, workflow, integration, model, dataset, event, field or recipient changes personal-data processing.

**Method**
1. Define product/system outcome and affected people.
2. Create/update Data Processing Contract and Data Action Graph.
3. Run purpose, authority, minimization, retention, access, rights, telemetry, vendor/transfer and deletion gates.
4. Classify privacy risk and determine whether PIA/DPIA is required.
5. Threat-model problematic data actions and high-consequence abuse cases.
6. Define controls, tests, owner, residual risk and review triggers.

**Acceptance criteria**
- [ ] No unexplained data store/recipient.
- [ ] Required scoped legal/privacy review complete.
- [ ] Material controls have test evidence.
- [ ] Residual risk has owner/acceptance.
- [ ] Retention/deletion behavior is executable.

## PRIV-02 — Add a personal-data field or event attribute

**Use when:** A schema, event, log, API, analytic property or model feature adds or increases granularity of personal data.

**Method**
1. Name the purpose/decision enabled.
2. Challenge necessity: removal/coarsening/sampling/pseudonymisation.
3. Classify sensitivity/identifiability.
4. Define consumers, access and retention.
5. Update telemetry/deletion lineage.
6. Add schema/policy tests.

**Acceptance criteria**
- [ ] Purpose and owner exist.
- [ ] Minimum precision selected.
- [ ] No undocumented consumer.
- [ ] Retention/deletion defined.
- [ ] Inventory/schema metadata updated.

## PRIV-03 — Introduce or change telemetry

**Use when:** Logs, metrics, traces, replay, analytics, crash reporting, support capture or AI traces change.

**Method**
1. Define operational question.
2. Create schema allowlist.
3. Remove/transform unnecessary content/identifiers.
4. Define sampling, retention, access, region, processor.
5. Test redaction and scan production samples.
6. Define emergency-debug exception with automatic expiry.

**Acceptance criteria**
- [ ] Telemetry answers named questions.
- [ ] Sensitive fields blocked/redacted.
- [ ] Retention/access enforced.
- [ ] Unexpected-data scan passes.
- [ ] Emergency mode expires automatically.

## PRIV-04 — Evaluate new purpose / secondary use

**Use when:** Existing data is proposed for analytics, personalization, training, advertising, research, enrichment, fraud, safety or another materially new use.

**Method**
1. State original/proposed purposes separately.
2. Assess compatibility/authority under applicable overlays.
3. Assess expectations, harm, sensitivity, scale, identifiability and alternatives.
4. Minimize/transform dataset.
5. Decide whether notice/choice/consent/contract or prohibition applies.
6. Record decision and revisit trigger.

**Acceptance criteria**
- [ ] No generic purpose laundering.
- [ ] Data minimized for new purpose.
- [ ] Downstream retention/deletion updated.
- [ ] Decision owner and evidence recorded.

## PRIV-05 — Set or change retention

**Use when:** A store, log, export, backup, vector or model-related dataset lacks/changes retention.

**Method**
1. Identify purpose end-state.
2. Identify scoped legal/contractual constraints.
3. Choose event/time trigger.
4. Define live/archive/backup/hold states.
5. Automate enforcement and exception expiry where practical.
6. Test expiration and rehydration behavior.

**Acceptance criteria**
- [ ] Rationale documented.
- [ ] Expiry enforceable.
- [ ] Holds isolated/scoped.
- [ ] Backup behavior known.
- [ ] Expired data cannot silently reappear.

## PRIV-06 — Implement deletion / erasure

**Use when:** User, product lifecycle or policy requires removal.

**Method**
1. Enumerate primary/derived stores from lineage.
2. Run idempotent deletion by store/processor.
3. Delete or put beyond use according to scoped constraints.
4. Retain only minimal suppression/tombstone evidence where justified.
5. Validate processor propagation.
6. Run restore/replay/reindex regression.

**Acceptance criteria**
- [ ] Live stores satisfy deletion policy.
- [ ] Processor completion tracked.
- [ ] Backup state is defined.
- [ ] Restore cannot resurrect data.
- [ ] Failures retry/escalate instead of false success.

## PRIV-07 — Fulfil access/export/correction/objection/restriction

**Use when:** An applicable individual right or product commitment is exercised.

**Method**
1. Authenticate requester proportionately.
2. Resolve subject identity across identifiers.
3. Query inventory-driven stores/processors.
4. Apply scoped exceptions through qualified review where needed.
5. Execute/propagate action.
6. Record response evidence with retention.

**Acceptance criteria**
- [ ] Search completeness tested.
- [ ] Verification proportionate.
- [ ] Hidden stores/processors included.
- [ ] Output/action is accurate.
- [ ] Deadline/escalation tracked.

## PRIV-08 — Onboard/change a processor/vendor

**Use when:** A third party receives, hosts, supports, analyzes or otherwise processes personal data.

**Method**
1. Determine roles.
2. Map data, purpose, region, support and subprocessors.
3. Assess technical privacy/security evidence.
4. Define retention, deletion, rights, incident and audit obligations.
5. Evaluate transfer mechanism where applicable.
6. Define subprocessor change and exit.

**Acceptance criteria**
- [ ] Role/instructions clear.
- [ ] Material regions/subprocessors known.
- [ ] Deletion/exit testable.
- [ ] Transfer basis recorded if needed.
- [ ] Technical evidence supports contract claims.

## PRIV-09 — Authorize cross-border/cross-jurisdiction flow

**Use when:** Storage, support, replication or remote access crosses relevant jurisdiction boundaries.

**Method**
1. Map source/destination/remote access/onward flows.
2. Identify applicable restrictions/roles.
3. Check current adequacy/mechanism status from primary sources.
4. Assess supplementary measures where required.
5. Minimize data and remote privileges.
6. Record review/revisit trigger.

**Acceptance criteria**
- [ ] Residency and transfer are separate.
- [ ] Current authoritative status checked.
- [ ] Remote access/onward transfer included.
- [ ] Change triggers configured.

## PRIV-10 — Run a PIA/DPIA

**Use when:** Processing is high risk, novel, sensitive, large-scale, systematic, consequential or legally required.

**Method**
1. Describe purpose, scope, people, data actions and technology.
2. Assess necessity/proportionality and alternatives.
3. Model threats and human impacts.
4. Identify legal/regulatory requirements separately.
5. Specify mitigations, tests, residual risk.
6. Obtain required consultation/approval.

**Acceptance criteria**
- [ ] Assessment precedes high-risk launch.
- [ ] Alternatives considered.
- [ ] Residual risk explicit.
- [ ] Controls trace to tests.
- [ ] Required approvals complete.

## PRIV-11 — Privacy threat model

**Use when:** A material system/change alters identification, linkage, inference, surveillance, disclosure or control.

**Method**
1. Map actors, data actions, trust boundaries and identifiers.
2. Apply NIST + RFC/LINDDUN-style analysis.
3. Describe harms and affected groups.
4. Rank qualitatively by likelihood/impact/context.
5. Select minimization, architecture, access, PET, UX and lifecycle controls.
6. Create abuse tests.

**Acceptance criteria**
- [ ] Authorized processing threats included.
- [ ] Human harm explicit.
- [ ] Controls have owner/test.
- [ ] New data actions trigger review.

## PRIV-12 — Respond to privacy incident / suspected breach

**Use when:** Unexpected disclosure, purpose drift, excessive collection, rights/deletion failure, invasive inference or another problematic data action occurs.

**Method**
1. Contain harmful processing without destroying required evidence.
2. Identify data, people, recipients, time window and protections.
3. Classify privacy incident and separately assess legal notification.
4. Notify required channels on applicable timelines.
5. Repair controls/reconcile copies.
6. Run system-focused learning review.

**Acceptance criteria**
- [ ] Harm contained.
- [ ] Legal reporting decision documented.
- [ ] Scope evidence sufficient.
- [ ] Corrective controls validated.
- [ ] Incident evidence has defined retention.

## PRIV-13 — Approve AI/LLM/RAG/agent personal-data use

**Use when:** Personal data enters prompts, retrieval, training, evals, memory, fine-tuning, tool traces or outputs.

**Method**
1. Map each AI surface separately.
2. Define purpose/authority for inference versus training/eval reuse.
3. Enforce deterministic authorization before RAG/tool access.
4. Define retention/deletion for prompts, memory, vectors, traces and datasets.
5. Assess identification/extraction/memorization where material.
6. Define agent disclosure/write/delete boundaries.

**Acceptance criteria**
- [ ] No model-mediated authorization.
- [ ] Training reuse separately justified.
- [ ] Memory/vector lifecycle defined.
- [ ] Provider data policy verified.
- [ ] Material leakage tests pass.

## PRIV-14 — Process children or highly sensitive data

**Use when:** Processing involves children/vulnerable people or highly sensitive categories.

**Method**
1. Identify sensitivity/regulatory trigger.
2. Escalate assurance/specialist review.
3. Minimize collection/secondary use.
4. Design age/guardian/consent controls only as required, minimizing age-assurance data itself.
5. Restrict profiling/advertising/sharing where required.
6. Test access, deletion, choice and inference risks.

**Acceptance criteria**
- [ ] High-risk review complete.
- [ ] Age/sensitivity evidence minimized.
- [ ] No unapproved secondary use.
- [ ] Protective defaults.
- [ ] Rights/guardian logic tested where applicable.

## PRIV-15 — Release de-identified/anonymized data

**Use when:** Data is proposed for broader internal use, external sharing, publication or research because it is claimed de-identified/anonymized.

**Method**
1. Define release context/auxiliary data.
2. Apply transformations.
3. Assess singling, linkage, inference and re-identification.
4. Test realistic adversaries where consequence warrants.
5. Add recipient/use controls when technical anonymity is insufficient.
6. Set re-evaluation trigger.

**Acceptance criteria**
- [ ] No name-removal-only claim.
- [ ] Recipient-context risk assessed.
- [ ] Residual identifiability recorded.
- [ ] Release controls match risk.
- [ ] Review trigger exists.

## PRIV-16 — Retire feature, dataset, model or system

**Use when:** Processing is deprecated/shut down.

**Method**
1. Identify users/dependents and scoped retention duties.
2. Stop new collection and revoke integrations/credentials.
3. Export/return required data.
4. Delete/anonymize personal data and processor copies.
5. Retire telemetry, backups, indexes, vectors/model artifacts intentionally.
6. Archive only necessary accountability evidence.

**Acceptance criteria**
- [ ] No new processing remains.
- [ ] Data disposition complete.
- [ ] Vendor exit complete.
- [ ] Credentials revoked.
- [ ] Residual archive has purpose/retention/owner.

---

# 39. Privacy readiness checklist

## Purpose and scope
- [ ] Processing outcome and purpose are explicit.
- [ ] Affected people/groups are identified.
- [ ] Required versus optional processing is separated.
- [ ] Applicable jurisdiction/sector overlays are identified.
- [ ] Purpose and authority/legal basis are not conflated.

## Data minimization
- [ ] Every material field/event has a necessity rationale.
- [ ] Precision/frequency/population/identifiability were minimized.
- [ ] Derived/inferred data are included.
- [ ] Production data is not copied to non-production without explicit control.

## Architecture
- [ ] Data Action Graph / flow map is current.
- [ ] Stores, replicas, indexes, caches, queues and vendors are mapped.
- [ ] Tenant boundaries are explicit.
- [ ] RAG/agent authorization occurs before model access.
- [ ] High-risk identifier mappings are separated where useful.

## Access
- [ ] Least privilege enforced.
- [ ] Human support/admin access constrained and auditable.
- [ ] Machine/agent identities scoped.
- [ ] Break-glass access controlled.

## Telemetry
- [ ] Logs/traces/analytics/replay reviewed.
- [ ] Sensitive data redacted/blocked.
- [ ] Telemetry retention/access defined.
- [ ] Unexpected-data scanning exists where risk warrants.

## Retention/deletion
- [ ] Retention rule/trigger exists.
- [ ] Holds scoped.
- [ ] Deletion graph covers material stores/processors.
- [ ] Backup behavior explicit.
- [ ] Restore cannot resurrect deleted data.
- [ ] Derived/vector/model implications documented.

## Rights/control
- [ ] Rights applicability assessed.
- [ ] Discovery covers hidden stores/processors.
- [ ] Identity verification proportionate.
- [ ] Preference/consent state affects actual processing.

## Vendors/transfers
- [ ] Roles, subprocessors and regions current.
- [ ] Vendor retention/deletion/exit understood.
- [ ] Transfer analysis current where required.
- [ ] Residency is not used as substitute for transfer analysis.

## Risk/assurance
- [ ] Privacy threat model includes problematic authorized data actions.
- [ ] PIA/DPIA trigger assessed.
- [ ] High-risk/children/sensitive controls escalated.
- [ ] Material controls have test evidence.
- [ ] Residual risk has owner and acceptance/escalation.

---

# 40. Change / pull-request privacy review

Ask for each material change:

- Does it add a field, event, identifier, recipient or inference?
- Does it increase precision, frequency, visibility or retention?
- Does it add logging/replay/analytics?
- Does it change vendor/subprocessor/region?
- Does it create a new purpose/training reuse?
- Does it alter access policy?
- Does it add a model/agent tool?
- Does it affect deletion or rights discovery?
- Does it change backup/replay?
- Does it create a new export?
- Does it modify child/sensitive processing?
- Is the canonical processing record updated?

A code-only diff can still be a privacy-relevant behavior change.

---

# 41. Data migration privacy standard

Migrations create transient and duplicate copies.

Before migration:

- classify source/target data;
- minimize transferred fields;
- restrict migration operator access;
- protect transport;
- define staging/temp-file TTL;
- validate target access;
- define rollback/fallback;
- prevent indefinite dual-running copies;
- reconcile records and deletion state;
- destroy temporary exports;
- migrate suppression/deletion markers;
- update rights/lineage inventory.

If rollback can restore deleted/expired data, the migration design is incomplete.

---

# 42. Backup and disaster-recovery privacy standard

```yaml
backup_scope:
personal_data_classes:
encryption:
key_control:
access_roles:
regions:
retention:
immutability:
legal_hold:
selective_delete_capability:
beyond_use_strategy:
restore_quarantine:
deletion_ledger_replay:
post_restore_privacy_reconciliation:
test_cadence:
owner:
```

An immutable backup can protect resilience while complicating deletion. Resolve the tension through lifecycle, access and restore controls rather than pretending either requirement does not exist.

---

# 43. Data export and download standard

Exports create copies outside ordinary application controls.

Use as appropriate:

- explicit recipient;
- minimum fields;
- sensitivity label;
- short-lived signed download URL;
- encryption;
- limited access window;
- download audit;
- no permanent public object URL by default;
- no embedded credentials;
- automatic export expiry;
- downstream restrictions/contract where material;
- higher approval for bulk/high-sensitivity exports.

---

# 44. Database and storage patterns

## 44.1 Column/field classification

Attach classification/purpose metadata close to schema where tooling supports it.

## 44.2 Row-level/tenant policy

Database row-level security may provide defense in depth. It is not automatically sufficient for application authorization; verify the architecture.

## 44.3 Soft delete

Soft delete is not erasure.

Use soft-delete only when a defined product/recovery purpose exists, with retention and later physical/anonymization lifecycle.

## 44.4 Event sourcing

Immutable logs complicate correction/deletion.

Before adopting personal-data event sourcing, define:

- event minimization;
- pseudonymous references;
- correction/redaction strategy;
- projection deletion;
- replay behavior;
- snapshot lifecycle;
- rights/legal model.

"Immutable architecture" does not override scoped deletion duties.

## 44.5 Search indexes and caches

Source deletion MUST trigger or eventually guarantee invalidation consistent with the deletion SLO. Index/cache TTL alone is acceptable only when its maximum lifetime and access behavior meet the intended deletion outcome.

---

# 45. Privacy-preserving analytics

Prefer the lowest data tier sufficient for a decision:

```text
RAW INDIVIDUAL DATA
→ PSEUDONYMIZED / RESTRICTED
→ AGGREGATED / COARSENED
→ FORMALLY PRIVATE RELEASE (when appropriate)
```

Self-service analytics MUST NOT become self-service raw-person access.

For dashboards:

- suppress overly small groups where re-identification risk warrants;
- avoid unnecessary stable identifiers;
- review drill-down capability;
- enforce tenant/role boundaries;
- cap long-lived event retention;
- audit bulk export.

---

# 46. Data quality and privacy

Privacy can be harmed by incorrect data, not only excessive data.

Engineering should support:

- source/provenance;
- accuracy checks;
- correction;
- conflict resolution;
- stale-data detection;
- correction propagation;
- derived score/inference recomputation where relevant.

A wrong sensitive inference can be harmful even if perfectly secured.

---

# 47. Privacy and security/fraud monitoring

Security/fraud can be legitimate processing purposes in some contexts, but "security" is not limitless.

Define:

- threat/use case;
- data needed;
- retention;
- analyst access;
- raw evidence vs long-term indicator separation;
- device fingerprinting/linkage;
- false-positive consequences;
- hold/incident lifecycle;
- deletion/de-identification after need ends.

---

# 48. Privacy and experimentation / A-B testing

Before experiment:

- purpose/hypothesis;
- population;
- fields/events;
- randomization identifier;
- sensitive segment exclusion;
- manipulation/choice risk;
- telemetry retention;
- decision rule;
- post-experiment disposition.

Do not keep event-level experiment data indefinitely "for future analysis."

---

# 49. Privacy and authentication / identity proofing

Identity proofing can itself create high-sensitivity data.

Principles:

- proof only to the level needed for the risk;
- avoid storing raw identity documents where a derived verified claim is enough;
- separate proofing vendor data from product profile data;
- do not repurpose identity documents;
- delete proofing artifacts after their purpose ends;
- distinguish account authentication from legal identity;
- protect recovery flows from over-collection.

---

# 50. Privacy and location / biometrics

Precise location and biometrics can be difficult to revoke and can enable sensitive inferences.

Where used:

- document necessity;
- prefer on-device comparison/processing where feasible;
- minimize raw templates/signals;
- separate enrollment from use;
- define deletion/re-enrollment;
- protect spoofing/false match recovery;
- avoid unrelated analytics/training reuse;
- escalate assurance/legal review.

---

# 51. Privacy and communications / collaboration data

Messages, documents, email, meeting transcripts and workspace content often contain personal data about **multiple people**, not only the account holder.

Design:

- sender/recipient/access scope;
- organizational ownership vs individual rights;
- attachment lifecycle;
- retention/legal hold;
- search/vector indexing;
- model summarization/training;
- export and eDiscovery;
- deleted-account references;
- shared-memory provenance.

Do not assume a user can unilaterally delete all copies of a shared record when other scoped obligations/rights apply. Define the system semantics explicitly.

---

# 52. Privacy and data lineage

## 52.1 Lineage purpose

Lineage should answer:

```text
SOURCE
→ TRANSFORMATIONS
→ DERIVED DATA
→ STORES
→ CONSUMERS
→ RECIPIENTS
→ RETENTION
→ DELETION
```

## 52.2 High-value lineage queries

- Which systems contain data about subject/account X?
- Which datasets depend on field Y?
- Which processors receive category Z?
- Which models/evals were built from dataset D?
- Which exports exist after purpose P ended?
- Which stores will deletion event E reach?
- Which processing changes if a regulation/contract changes?

## 52.3 Lineage limits

A perfect enterprise graph can be expensive. Use depth proportional to risk and automate from schemas/infrastructure/events where possible.

---

# 53. Privacy engineering for distributed systems

Distributed systems create privacy-specific failure modes:

- duplicate delivery creates duplicate data;
- retries re-send sensitive payloads;
- dead-letter queues retain data indefinitely;
- eventual consistency delays deletion;
- region replication creates transfers;
- caches preserve stale data;
- event replays resurrect deleted attributes;
- out-of-order preference events re-enable tracking;
- reconciliation jobs repopulate suppressed records.

Requirements:

- privacy-relevant operations should be idempotent where practical;
- preference/deletion events need version/order semantics;
- queues/DLQs need retention;
- replication locations must be in inventory;
- replay must respect current deletion/restriction state.

---

# 54. Privacy state machines

Use explicit state where semantics matter.

## 54.1 Consent/preference

```text
UNKNOWN
→ GRANTED(version/scope)
→ WITHDRAWN
→ EXPIRED / RECONSENT_REQUIRED
```

## 54.2 Deletion

```text
REQUESTED
→ VERIFIED
→ EXECUTING
→ PARTIAL_FAILURE
→ RETRYING
→ LIVE_COMPLETE
→ BACKUP_ONLY
→ FULLY_EXPIRED
```

## 54.3 Vendor deletion

```text
REQUESTED
→ ACKNOWLEDGED
→ PROCESSOR_COMPLETE
→ SUBPROCESSOR_COMPLETE
→ EVIDENCE_RETAINED
```

Explicit state prevents false "done" reporting.

---

# 55. Anti-patterns and falsified privacy folklore

### 55.1 "Encrypted therefore private"
Encryption reduces some confidentiality risks; it does not establish purpose, necessity, fairness, retention or rights.

### 55.2 "Consent solves privacy"
Consent is a scoped legal/choice mechanism where applicable, not permission to ignore minimization or fairness.

### 55.3 "We removed names, so it is anonymous"
Indirect identifiers, uniqueness and auxiliary data can still identify people.

### 55.4 "We hashed the email, so it is anonymous"
Deterministic hashes of guessable identifiers are usually linkable and can be brute-forced.

### 55.5 "Pseudonymised means out of privacy scope"
Pseudonymisation reduces risk; it commonly remains personal data in scoped regimes.

### 55.6 "Delete from the users table = erased"
Copies, caches, events, processors, vectors and backups can preserve data.

### 55.7 "Backups are exempt from deletion"
Backups require a deletion/beyond-use/expiry/restore-safe model.

### 55.8 "Logs are operational, not personal"
Logs can include identifiers, content, URLs, IPs, support context and sensitive errors.

### 55.9 "IP addresses are anonymous"
Network/device identifiers can be identifying or linkable depending on context and law.

### 55.10 "More analytics data is always useful"
Collection increases risk, cost, governance and breach impact; analytics must earn its data.

### 55.11 "We might use it for AI later"
Future optional use is not a specific purpose.

### 55.12 "Model weights cannot contain personal data"
Model anonymity is context-specific; extraction/identification may be possible `[EU11]`.

### 55.13 "Embeddings are anonymous"
Embeddings can preserve semantic information and linkability; classify by source/use/threat.

### 55.14 "RAG authorization happens in the prompt"
Authorization belongs in deterministic policy before retrieval.

### 55.15 "A privacy policy makes processing transparent"
Product behavior and user-facing explanation must match actual data actions.

### 55.16 "A cookie banner equals privacy compliance"
Terminal access is one possible obligation; lifecycle/privacy duties remain.

### 55.17 "EU hosting means no international transfer"
Remote access/onward processing and legal transfer are separate.

### 55.18 "SCC signed = transfer solved"
A transfer tool can still require current status and supplementary/contextual assessment `[EU06][EU07]`.

### 55.19 "The DPA says the vendor is safe"
Contract terms are obligations, not runtime evidence.

### 55.20 "Legal owns privacy"
Legal interprets scoped obligations; engineering owns whether behavior is enforceable.

### 55.21 "DPIA completed = risk handled"
A DPIA is an assessment artifact; controls still need implementation and testing.

### 55.22 "Never collect sensitive data"
Some services legitimately require it; use necessity, higher assurance and scoped authority.

### 55.23 "Never retain data"
Retention can be necessary; minimize and govern instead of using absolutes.

### 55.24 "Differential privacy anonymizes everything"
Guarantees depend on adjacency, mechanism, parameters, composition and release model `[NIST03]`.

### 55.25 "k-anonymity proves anonymity"
It addresses limited properties and can fail with auxiliary data/inference.

### 55.26 "Privacy metrics are counts of DPIAs"
Activity metrics do not show whether processing behavior is controlled.

### 55.27 "Immutable event logs mean deletion is impossible, so deletion does not apply"
Architecture must adapt to scoped obligations; use minimization, tombstones/projections, redaction or alternative architecture.

### 55.28 "A data lake is internal, so purpose does not matter"
Internal reuse can still create purpose drift, overaccess and new inference.

### 55.29 "Service accounts are not people, so privacy access controls do not apply"
Machine principals can exfiltrate or overprocess personal data and need least privilege.

### 55.30 "Security logs must be kept forever"
Security evidence needs a retention purpose and proportionality like other data.

### 55.31 "A model provider says zero retention, so there is no privacy risk"
Zero content retention does not address metadata, access, legal roles, prompts, outputs, regional processing or the caller's own logs.

### 55.32 "If a user asked the agent, the agent may access all their data"
User intent does not override tenant/resource permissions or purpose constraints.

---

# 56. Canonical templates

## 56.1 Privacy Design Record

```yaml
record_id:
feature_or_system:
decision_owner:
date:
outcome:
people_affected:
purpose:
authority_overlay:
data_needed:
minimization_decisions:
data_flow:
access_model:
telemetry:
retention:
deletion:
rights:
vendors:
transfers:
privacy_threats:
pia_dpia_required:
tests:
residual_risk:
approval:
revisit_triggers:
```

## 56.2 Data Inventory Item

```yaml
data_id:
name:
description:
subject:
source:
sensitivity:
identifier_type:
purpose_ids:
store_ids:
recipient_ids:
retention_class:
deletion_class:
rights_lookup_key:
telemetry_allowed:
training_allowed:
owner:
```

## 56.3 Retention Exception

```yaml
exception_id:
data_scope:
normal_retention:
exception_reason:
authority:
start:
expires:
restricted_access:
owner:
approved_by:
review:
deletion_on_release:
```

## 56.4 Processor Review

```yaml
processor:
service:
role:
purpose:
data_categories:
regions:
remote_access:
subprocessors:
security_evidence:
privacy_evidence:
retention:
deletion:
backup:
rights:
training_use:
incident:
transfer:
exit:
residual_risk:
decision:
owner:
review_trigger:
```

## 56.5 Privacy Incident Record

```yaml
incident_id:
detected_at:
processing_id:
people_affected:
data_categories:
data_actions:
privacy_harm:
security_breach: true|false|unknown
scope:
recipients:
containment:
legal_notification_assessment:
notifications:
data_recovery_or_deletion:
root_conditions:
corrective_actions:
owners:
validation:
learning:
```

## 56.6 Privacy Threat Model

```yaml
system:
scope:
people:
data_actions:
identifiers:
trust_boundaries:
purposes:
threats:
  - threat:
    problematic_data_action:
    affected_people:
    harm:
    likelihood_context:
    impact_context:
    controls:
    detection:
    test:
residual_risk:
review_trigger:
```

## 56.7 PIA / DPIA Evidence Package

```yaml
assessment_id:
trigger:
processing:
necessity_proportionality:
alternatives:
people_and_vulnerabilities:
privacy_threats:
legal_overlay:
stakeholder_input:
controls:
tests:
residual_risk:
consultation:
approval:
monitoring:
reassessment_trigger:
```

## 56.8 Data Deletion Test Record

```yaml
test_id:
subject_fixture:
stores_expected:
processors_expected:
preconditions:
deletion_trigger:
execution_results:
restore_test:
replay_test:
index_cache_test:
derived_data_test:
evidence:
defects:
result:
```

## 56.9 AI Privacy Assessment

```yaml
ai_system:
model_provider:
model_version:
data_surfaces:
input_purposes:
training_eval_reuse:
rag_sources:
authorization_boundary:
memory:
embeddings_vectors:
provider_retention:
regions:
model_anonymity_assumption:
extraction_memorization_risk:
deletion_unlearning:
agent_tools:
tests:
residual_risk:
owner:
review_trigger:
```

---

# 57. Audit standard

A production privacy capability should be audited through **actual system evidence**, not policy presence alone.

Sample:

- schema/data catalog;
- flow/action map;
- IAM policy;
- privileged access logs;
- telemetry samples;
- retention jobs;
- deletion runs;
- restore drill;
- processor API/evidence;
- rights request test;
- de-identification test;
- model/RAG privacy eval;
- region/subprocessor config;
- incident evidence;
- changes since last PIA/DPIA.

## 57.1 Audit questions

### Scope
- Is material processing inventoried?
- Are shadow systems/exports present?

### Purpose
- Can each material use trace to purpose?
- Is secondary use occurring without a gate?

### Minimization
- Are unused/high-precision fields retained?
- Could collection/replication be narrower?

### Access
- Can staff/services query more than needed?
- Are privileges stale?

### Telemetry
- Are sensitive values present in logs/traces?
- Are schemas/redaction enforced?

### Retention
- Is data older than policy?
- Are holds expiring?

### Deletion
- Does deletion cover copies/processors?
- Does restore resurrect?

### Rights
- Does discovery cover all stores?
- Are responses/actions complete and secure?

### Vendors/transfers
- Do actual regions/subprocessors match records?
- Are deletion/exit claims demonstrable?

### AI
- Are prompts/vectors/memory/training/evals governed?
- Can unauthorized RAG/tool leakage occur?
- Can outputs expose personal data?

### Governance
- Are high risks owned/accepted?
- Are draft sources mislabeled as final?

---

# 58. Verification, validation and quality gates

## Gate 0 — Scope
Pass when purpose, affected people, boundary, owner and risk are known.

## Gate 1 — Evidence
Pass when applicable authorities/current source versions are identified and material claims classified.

## Gate 2 — Privacy architecture
Pass when data actions, stores, access, telemetry, retention, deletion, rights and processors are mapped.

## Gate 3 — Construction verification
Pass when deterministic privacy controls/workflows are technically tested.

## Gate 4 — User/scenario validation
Pass when realistic privacy scenarios and failure cases are executed by representative operators/users where material.

## Gate 5 — Release
Pass when residual risk, approvals, monitoring and review triggers exist.

## Gate 6 — Learning
Ongoing. Incidents, rights defects, telemetry leaks, access anomalies, source changes and new attack capabilities feed updates.

No R4 processing should launch with an unresolved `BLOCKER` privacy defect.

---

# 59. Defect severity

**BLOCKER**
- likely violation of a known applicable mandatory requirement;
- severe cross-tenant/sensitive exposure;
- no enforceable authorization;
- required high-risk assessment/approval absent;
- deletion falsely reported complete;
- unsupported anonymity claim enabling unsafe disclosure;
- child/sensitive processing bypassing mandatory controls.

**MAJOR**
- likely purpose drift;
- broad unnecessary access;
- overretention;
- incomplete rights discovery;
- telemetry sensitive-data leak;
- processor/region mismatch;
- material deletion gap;
- material AI/RAG privacy leakage.

**MINOR**
- clarity/process defect unlikely to change immediate outcome.

**EDITORIAL**
- formatting/wording only.

---

# 60. Lifecycle and status

```text
DRAFT
→ REVIEWED
→ TESTED
→ VALIDATED
→ SUPERSEDED / DEPRECATED
```

A PIA/processing record should be re-evaluated after material change to:

- purpose;
- data;
- recipient;
- vendor;
- region;
- model;
- agent capability;
- access;
- retention;
- scale;
- user population;
- legal/standards baseline.

---

# 61. Review cadence and event triggers

Scheduled review alone is insufficient.

Trigger review when:

- law/regulation changes;
- regulator guidance changes;
- a standard edition changes;
- vendor/subprocessor/region changes;
- sensitive data is introduced/inferred;
- AI model/provider changes materially;
- training reuse is proposed;
- privacy incident occurs;
- deletion/rights test fails;
- inventory drifts;
- product purpose changes;
- user population changes;
- new re-identification techniques/data sources invalidate assumptions.

For regulatory overlays, record the source-check date.

---

# 62. V1 → audit → V2 material changes

The full audit is in `07_privacy_data_protection_engineering_v1_audit.md`.

V2:

1. separates universal engineering invariants from legal overlays;
2. separates purpose from legal authority, consent and access;
3. expands minimization beyond field count;
4. introduces Data Action Graph and Data Processing Contract;
5. introduces distributed deletion states and restore-safe deletion;
6. corrects backup deletion semantics with beyond-use/expiry behavior;
7. makes pseudonymisation distinct from anonymisation;
8. adds contextual re-identification assessment;
9. makes telemetry a first-class data product;
10. adds derived data, embeddings, vectors and inference lifecycle;
11. adds authorization-before-RAG retrieval;
12. adds agent-memory provenance/TTL/deletion;
13. bounds model-unlearning claims as emerging/contextual;
14. adds processor technical evidence and exit testing;
15. separates residency from transfer analysis;
16. adds child/high-sensitivity assurance;
17. separates privacy incidents from legal breach classification;
18. adds control-health metrics rather than paperwork counts;
19. adds atomic plays, templates, QA gates and regression tests;
20. refreshes NIST/ISO/EDPB/CPPA source status through 2026-09-27.

---

# 63. Research sanity-check verdict

## HIGH-confidence findings

- Privacy is distinct from confidentiality/security `[NIST02][IETF01][BASE02]`.
- Purpose, minimization, retention, participation/control and accountability are durable principles across major source families `[OECD01][ISO01][EU01]`.
- Privacy by design starts before architecture is fixed `[ISO06][EU02]`.
- Pseudonymisation reduces risk but does not automatically establish anonymity `[ISO05][UK03]`.
- Anonymity/re-identification is contextual `[ISO05][UK03][EU11]`.
- Deletion is a lifecycle/process problem rather than a single storage call `[ISO04][UK02]`.
- PIA/DPIA is an established high-risk assessment mechanism `[ISO03][EU01]`.
- Logging/telemetry is processing and can create privacy risk `[NIST02][IETF01]`.
- AI model/data pipelines require separate privacy analysis; model anonymity is not categorical `[EU11]`.
- Applicable rule/version status must be maintained as a volatile overlay `[BASE01]`.

## Strong engineering defaults, contextual implementation

- allowlist telemetry schemas;
- just-in-time privileged access;
- local/on-device processing;
- automated retention;
- deletion ledgers/tombstones;
- synthetic privacy canaries;
- PET selection.

These are implementation patterns, not universal laws.

## Emerging / do not overclaim

- universal model-unlearning guarantees;
- one universal AI privacy eval suite;
- one universal numeric privacy-risk score;
- NIST PF 1.1 as final;
- EDPB Guidelines 01/2025 pseudonymisation as final `[NIST01][EU09]`.

---

# 64. Source register and annotated evidence map

| ID | Source | Evidence/status | Primary use | URL |
|---|---|---|---|---|
| **BASE01** | Master Playbook Standard v2.0-RC1 | HOUSE / uploaded foundation; 2026-09-27 | Risk-proportionate rigor, evidence/claim taxonomy, traceability, QA gates, audit, lifecycle and human+AI execution. | User-provided: master_playbook_standard_v2.0.md |
| **BASE02** | Universal Software & AI Engineering Master Playbook v2.0 | HOUSE / uploaded foundation; 2026-09-27 | Privacy distinct from security; minimization, lifecycle, telemetry, AI-memory and deletion engineering baseline. | User-provided: universal_software_ai_engineering_master_playbook_v2.md |
| **NIST01** | NIST Privacy Framework 1.0 / PF 1.1 Initial Public Draft | E4 government privacy-risk framework; Status checked 2026-09-27 | PF is a voluntary privacy risk-management framework; PF 1.1 remains IPD at cutoff. | https://www.nist.gov/privacy-framework |
| **NIST02** | NISTIR 8062 — An Introduction to Privacy Engineering and Risk Management in Federal Information Systems | E4 government privacy engineering; 2017; page updated 2026 | Privacy engineering objectives and privacy-risk model based on problematic data actions and impact to people. | https://www.nist.gov/publications/introduction-privacy-engineering-and-risk-management-federal-information-systems |
| **NIST03** | NIST SP 800-226 — Guidelines for Evaluating Differential Privacy Guarantees | E4 government technical guidance; 2025 | Evaluation guidance for differential privacy guarantees and hazards. | https://csrc.nist.gov/pubs/sp/800/226/final |
| **ISO01** | ISO/IEC 29100:2024 — Privacy framework | E1 international standard; Edition 2, 2024 | Privacy terminology, actors, safeguarding considerations and privacy principles for ICT. | https://www.iso.org/standard/85938.html |
| **ISO02** | ISO/IEC 27701:2025 — Privacy information management systems | E1 international standard; Edition 2, 2025 | Standalone PIMS requirements/guidance for PII controllers and processors. | https://www.iso.org/standard/27701 |
| **ISO03** | ISO/IEC 29134:2023 — Guidelines for privacy impact assessment | E1 international standard; Edition 2, 2023 | PIA process and report structure. | https://www.iso.org/standard/86012.html |
| **ISO04** | ISO/IEC 27555:2021 — Guidelines on PII deletion | E1 international standard; Published; under revision at cutoff | Deletion terminology, policy, documentation, roles and processes; DIS successor is draft. | https://committee.iso.org/standard/71673.html?browse=tc |
| **ISO05** | ISO/IEC 27559:2022 — Privacy enhancing data de-identification framework | E1 international standard; 2022 | Framework for identifying and mitigating re-identification risks across de-identified data lifecycle. | https://www.iso.org/standard/71677.html |
| **ISO06** | ISO 31700-1:2023 — Privacy by design for consumer goods and services | E1 international standard; 2023 | High-level lifecycle privacy-by-design requirements for consumer products/services. | https://www.iso.org/standard/84977.html |
| **ISO07** | ISO/IEC 27018:2025 — PII protection in public clouds acting as processors | E1 international standard; Edition 3, 2025 | Cloud-specific guidance for PII processors. | https://www.iso.org/standard/27018 |
| **OECD01** | OECD Privacy Guidelines | E4 intergovernmental principles; Revised 2013; current page checked 2026 | Collection limitation, data quality, purpose, use limitation, security, openness, participation and accountability. | https://legalinstruments.oecd.org/en/instruments/OECD-LEGAL-0188 |
| **IETF01** | RFC 6973 — Privacy Considerations for Internet Protocols | E4 internet privacy guidance; 2013 | Correlation, identification, secondary use, disclosure, exclusion and minimization concepts. | https://www.rfc-editor.org/rfc/rfc6973 |
| **LIND01** | LINDDUN Privacy Threat Modeling | E4/E7 open method; Site checked 2026 | Threat categories for linkability, identification, non-repudiation, detectability, disclosure, unawareness and non-compliance. | https://linddun.org/ |
| **EU01** | Regulation (EU) 2016/679 — GDPR | E0 binding regulation where applicable; Consolidated law checked 2026-09-27 | EU/EEA requirements for principles, lawful processing, rights, design/default, processors, security, DPIA, breach handling and transfers. | https://eur-lex.europa.eu/eli/reg/2016/679 |
| **EU02** | EDPB Guidelines 4/2019 on Article 25 | E4 regulator guidance; Final 2020-10-20 | Final guidance on data protection by design and by default. | https://www.edpb.europa.eu/documents/guideline/guidelines-42019-on-article-25-data-protection-by-design-and-by-default_en |
| **EU03** | EDPB Guidelines 07/2020 on controller and processor concepts | E4 regulator guidance; Final 2021 | Controller/processor roles and responsibilities. | https://www.edpb.europa.eu/our-work-tools/our-documents/guidelines/guidelines-072020-concepts-controller-and-processor-gdpr_en |
| **EU04** | EDPB Guidelines 05/2020 on consent | E4 regulator guidance; Final | Conditions for consent/withdrawal under GDPR. | https://www.edpb.europa.eu/our-work-tools/our-documents/guidelines/guidelines-052020-consent-under-regulation-2016679_en |
| **EU05** | EDPB Guidelines 03/2022 on deceptive design patterns | E4 regulator guidance; Final 2023 | Interface patterns that can impair data-protection choices/rights. | https://www.edpb.europa.eu/our-work-tools/our-documents/guidelines/guidelines-032022-deceptive-design-patterns-social-media_en |
| **EU06** | EDPB Recommendations 01/2020 on supplementary transfer measures | E4 regulator guidance; Final 2021 | Third-country transfer assessment and supplementary measures. | https://www.edpb.europa.eu/our-work-tools/our-documents/recommendations/recommendations-012020-measures-supplement-transfer_en |
| **EU07** | European Commission Standard Contractual Clauses | E0/E4 legal transfer mechanism; 2021 clauses; status checked 2026 | One transfer mechanism; scope and supplementary analysis remain contextual. | https://commission.europa.eu/law/law-topic/data-protection/international-dimension-data-protection/standard-contractual-clauses-scc_en |
| **EU08** | European Commission adequacy decisions | E0/E4 official status register; Checked 2026-09-27 | Official current adequacy-status source; recheck before production transfer decisions. | https://commission.europa.eu/law/law-topic/data-protection/international-dimension-data-protection/adequacy-decisions_en |
| **EU09** | EDPB Guidelines 01/2025 on Pseudonymisation | E4 regulator guidance — DRAFT/WATCH; Closed consultation; not final at cutoff | Directional source only until final publication. | https://www.edpb.europa.eu/public-consultations/guidelines-012025-on-pseudonymisation_en |
| **EU10** | Directive 2002/58/EC (ePrivacy Directive), as amended | E0 directive as nationally implemented; Current directive baseline | Terminal storage/access and communications-privacy constraints can apply beyond GDPR. | https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:02002L0058-20091219 |
| **EU11** | EDPB Opinion 28/2024 on personal data in AI models | E4 regulator opinion; 2024-12-18 | Addresses model anonymity, legitimate interest and unlawful training-data implications. | https://www.edpb.europa.eu/documents/opinion-of-the-board-art-64/opinion-282024-on-certain-data-protection-aspects-related-to_en |
| **EU12** | EU AI Act — Article 50 transparency guidance | E0/E4 regulation + official guidance; Article 50 applicable from 2026-08-02 | AI transparency overlay; does not replace data protection. | https://digital-strategy.ec.europa.eu/en/library/guidelines-transparency-obligations-providers-and-deployers-ai-systems |
| **UK01** | ICO — Data protection by design and by default | E4 regulator guidance; Checked 2026; some UK guidance under DUAA review | Lifecycle integration of data protection into processing/defaults. | https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/ |
| **UK02** | ICO — Right to erasure | E4 regulator guidance; Checked 2026 | Backup erasure/beyond-use pattern and transparency. | https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/individual-rights/individual-rights/right-to-erasure/ |
| **UK03** | ICO — Anonymisation and pseudonymisation guidance | E4 regulator technical guidance; Published 2025; under DUAA review | Contextual identifiability and pseudonymisation/anonymisation risk. | https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/data-sharing/anonymisation/ |
| **US01** | California Privacy Protection Agency — CCPA 2025 regulation package | E0/E4 state regulation + guidance; Effective 2026-01-01; staged compliance | Risk assessments, cybersecurity audits, ADMT and CCPA updates. | https://cppa.ca.gov/regulations/ccpa_updates.html |
| **US02** | FTC — 2025 COPPA Rule amendments | E0/E4 federal rule + guidance; Final rule; current status must be checked at deployment | Child privacy, parental control, minimization/retention and targeted-advertising restrictions. | https://www.ftc.gov/news-events/news/press-releases/2025/01/ftc-finalizes-changes-childrens-privacy-rule-limiting-companies-ability-monetize-kids-data |
| **US03** | HHS — HIPAA Privacy Rule / minimum necessary | E0/E4 sector rule + guidance; Current official guidance | Sector/entity-specific health privacy requirements. | https://www.hhs.gov/hipaa/for-professionals/privacy/index.html |

## 64.1 Source interpretation rules

1. Inclusion does not imply equal weight.
2. `E0` law is mandatory only where it applies; it does not prove technical optimality.
3. `E1` standards provide baselines/frameworks; do not cargo-cult every control into low-risk contexts.
4. Regulatory guidance should be interpreted within the regulator's jurisdiction and status.
5. Draft sources are not final requirements.
6. A security standard does not by itself cover privacy-purpose/fairness/minimization.
7. Privacy principles are durable; implementation mechanisms remain context-dependent.
8. AI privacy facts are fast-moving and require model/provider/version-specific verification.
9. Transfer mechanisms/adequacy status must be checked close to deployment.
10. Local production evidence can falsify an implementation hypothesis but cannot erase binding legal obligations.

---

# 65. Traceability spine

For R3/R4 implementations, material privacy requirements/decisions SHOULD be traceable:

```text
REQUIREMENT / PURPOSE
→ DATA ACTION
→ PRIVACY RISK / THREAT
→ CONTROL
→ PLAY / IMPLEMENTATION
→ TEST
→ OBSERVED RESULT
→ INCIDENT / EXCEPTION
→ CHANGE
```

Compact matrix:

| ID | Requirement/purpose | Risk | Control | Artifact | Test/evidence | Outcome signal | Status |
|---|---|---|---|---|---|---|---|
| Example-01 | Limit support access | insider/overaccess | JIT + masking | support gateway | access-policy test + audit sample | privileged access exceptions | illustrative |

The example row is illustrative, not a mandatory implementation.

---

# 66. Definition of Ready

A privacy-relevant change is ready for implementation when:

- [ ] product outcome and purpose are explicit;
- [ ] affected people/groups identified;
- [ ] initial data elements/actions known;
- [ ] applicable legal/contractual overlays have an owner;
- [ ] criticality/privacy risk selected;
- [ ] minimization alternatives considered;
- [ ] vendor/region/model dependencies known;
- [ ] PIA/DPIA trigger decided;
- [ ] retention/deletion implications understood;
- [ ] test/evidence strategy defined.

---

# 67. Definition of Done

The processing capability can be considered `VALIDATED` only when all applicable conditions pass.

## Intent and authority
- [ ] Purpose current and specific.
- [ ] Applicable authority/legal overlay current.
- [ ] Optional versus required processing clear.

## Data
- [ ] Data minimized.
- [ ] Derived/inferred data governed.
- [ ] Inventory/lineage current.

## Access and sharing
- [ ] Least privilege enforced.
- [ ] Tenant boundaries tested.
- [ ] Processors/recipients current.
- [ ] Transfers assessed where applicable.

## Lifecycle
- [ ] Retention enforced.
- [ ] Deletion end-to-end tested.
- [ ] Backup restore cannot resurrect deleted data.
- [ ] Retirement/exit path exists.

## Rights/control
- [ ] Applicable rights executable.
- [ ] Identity verification proportionate.
- [ ] Choice/withdrawal state controls real processing.

## Observability
- [ ] Telemetry minimized/redacted.
- [ ] Control-health signals exist.
- [ ] Privacy incident path exists.

## AI/agents
- [ ] AI data surfaces inventoried.
- [ ] Retrieval/tool authorization outside model.
- [ ] Memory/vector lifecycle defined.
- [ ] Training/eval reuse separately approved.
- [ ] Material leakage/extraction scenarios tested.

## Assurance
- [ ] Material controls trace to tests/evidence.
- [ ] No unresolved BLOCKER.
- [ ] MAJOR defects closed or formally accepted.
- [ ] Required qualified privacy/legal review completed.
- [ ] Review triggers/owner set.
- [ ] Representative non-author execution completed where Playbook 00 requires it.

---

# 68. One-page Golden Standard

1. **Start with purpose and people, not data availability.**
2. **Separate purpose from legal authority, consent and technical access.**
3. **Collect/infer the minimum data at the minimum precision, frequency, population, identifiability and lifetime.**
4. **Treat privacy as risk from data actions to people, not merely confidentiality risk.**
5. **Map every material source, transformation, store, recipient, vendor, telemetry path, model surface and deletion state.**
6. **Treat derived data and inferences as real data.**
7. **Do not repurpose data without a new-purpose gate.**
8. **Default optional processing/exposure toward the privacy-protective state unless context justifies otherwise.**
9. **Use least-data access and least privilege; privileged human/agent access is controlled production access.**
10. **Treat telemetry as a data product with purpose, schema, retention, access and deletion.**
11. **Pseudonymisation is not anonymity; hashing is not anonymity.**
12. **Anonymity is a contextual re-identification conclusion that can expire.**
13. **Set retention when data is introduced; enforce it automatically where practical.**
14. **Design deletion across copies, processors, backups, derived stores, vectors and restore/replay.**
15. **A restore must not resurrect validly deleted data.**
16. **Engineer applicable rights as discovery/orchestration capabilities, not manual heroics.**
17. **Treat vendor contracts as obligations, not proof; test critical deletion/access/exit claims.**
18. **Residency, remote access and international transfer are different questions.**
19. **Threat-model authorized problematic data actions such as inference, surveillance, secondary use and exclusion.**
20. **Use PIA/DPIA before high-risk processing where required or risk justifies it.**
21. **Escalate protection for children, vulnerable people and highly sensitive/consequential data.**
22. **Treat prompts, vectors, memory, traces, training/eval data and outputs as independent AI privacy surfaces.**
23. **Authorize RAG/tool access before model retrieval; the model is not the policy engine.**
24. **Do not promise model unlearning or anonymity without evidence for the actual system.**
25. **Privacy incidents include harmful designed/authorized processing, not only attacker breaches.**
26. **Build privacy controls into CI/CD and production audits where they can be deterministically tested.**
27. **Measure privacy outcomes/control health, not review paperwork.**
28. **Attach laws/regulations as scoped overlays; do not universalize one jurisdiction.**
29. **Track source/version status; drafts are watch items, not final requirements.**
30. **Retain evidence from requirement → risk → control → test → observed result → improvement.**

---

# 69. V2 release note

`2.0` is a **research-audited, falsification-weighted privacy engineering standard** based on the uploaded Playbook 00 and Universal Software & AI Engineering Master Playbook plus current primary/authoritative privacy sources through **27 September 2026**.

It is intentionally **not** labeled `VALIDATED`: Playbook 00 requires representative non-author execution and stronger independent assurance for high-rigor work. Before using this artifact as a regulated organization's final compliance standard, attach the relevant jurisdictional/sector overlays and obtain qualified privacy/legal review.


---

# 70. Mechanical QA audit

The delivered V2 artifact was mechanically checked after final synthesis:

```text
lines: 3611
words: 0
Markdown code-fence markers: 122
code fences balanced: yes
evidence IDs used: 32
evidence IDs defined in register: 33
missing evidence definitions: 0
placeholder markers (TODO/TBD/FIXME/PLACEHOLDER): 0
```

Mechanical conformance is not substantive validation. `VALIDATED` status still requires the applicable Playbook 00 non-author/field and independent assurance conditions.
