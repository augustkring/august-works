# 12 — Data, Database & Storage Engineering — V2 Golden Master

> **Evergreen evidence-based standard for modeling, integrity, transactions, consistency, concurrency, storage, recovery, migrations, and multi-tenancy**

```yaml
document_id: PB-12-DATA
title: "12 — Data, Database & Storage Engineering"
artifact_type: domain_playbook
primary_archetype:
  - Operating
  - Decision
  - Execution
  - Response
  - Capability
version: 2.0
release_label: GOLDEN_MASTER
status: REVIEWED
created: 2026-09-27
last_updated: 2026-09-27
last_reviewed: 2026-09-27
evidence_cutoff: 2026-09-27
assurance_pass: SECOND_DEEP_RESEARCH_SANITY_CHECK_2026-09-27
canonical_language: English
owner_role: Data & Storage Engineering Capability Owner
research_rigor: R3_CONTROLLED
default_system_criticality: C2_MATERIAL
volatility: MODERATE_WITH_FAST_VENDOR_WATCHLIST
inherits:
  - Master Playbook Standard v2.0-RC1
  - Universal Software & AI Engineering Master Playbook v2.0
supersedes:
  - "12 — Data, Database & Storage Engineering — V1"
review_cadence: risk-and-volatility-based
review_triggers:
  - database or storage engine major-version change
  - SQL or relevant ISO/NIST standard revision
  - data corruption or recovery incident
  - migration failure or severe lock/latency event
  - tenant isolation incident
  - material architecture or consistency-model change
  - new legal/regulatory data requirement
```

## Status note

`GOLDEN_MASTER` is the release label for the canonical V2 content produced after research, V1 construction, falsification, corrective synthesis, and a second full-source sanity/freshness pass on 2026-09-27. Its Playbook 00 lifecycle status is deliberately `REVIEWED`, not `VALIDATED`. Research quality and internal audit do not substitute for representative non-author execution, field evidence, and closure of defects discovered in actual use [BASE00]. No static playbook can honestly guarantee 100% correctness across every engine, workload, failure mode, jurisdiction, or future version; this release therefore treats unsupported certainty as a defect and preserves explicit boundary conditions, watch items, and validation gates.

---

# Executive synthesis

Data engineering is not the act of choosing a database or drawing tables. It is the discipline of preserving **meaning, integrity, authority, recoverability, and acceptable access to state over time** while that state is read, written, copied, cached, replicated, migrated, partitioned, restored, deleted, attacked, and changed by concurrent humans and software.

The durable sequence is:

```text
DEFINE THE DOMAIN FACTS AND OUTCOMES
→ IDENTIFY AUTHORITATIVE STATE AND OWNERSHIP
→ STATE INVARIANTS AND FAILURE CONSEQUENCES
→ CHOOSE THE LEAST COMPLEX DATA MODEL THAT CAN ENFORCE THEM
→ DEFINE TRANSACTION, ISOLATION, CONSISTENCY AND CONFLICT SEMANTICS
→ CHOOSE STORAGE AND ACCESS PATHS FROM REAL WORKLOADS
→ DESIGN RECOVERY BEFORE DATA BECOMES IRREPLACEABLE
→ DESIGN SCHEMA/STATE EVOLUTION BEFORE LIVE MIGRATION
→ ISOLATE TENANTS, WRITERS, PRIVILEGES AND RESOURCE FAILURE DOMAINS
→ VERIFY CONCURRENCY, MIGRATION, CORRUPTION AND RESTORE PATHS
→ OPERATE WITH DATA-HEALTH AND TENANT-AWARE OBSERVABILITY
→ RECONCILE, REPAIR, LEARN AND EVOLVE WITHOUT LOSING CONTROL
→ ARCHIVE OR DELETE DELIBERATELY
```

The core doctrine is:

> **A data system is trustworthy only when important facts have clear authority, invalid states are difficult to create, concurrent updates preserve the required invariants, distributed copies have explicit consistency semantics, recovery is demonstrated rather than assumed, migrations preserve compatibility, and tenant boundaries survive ordinary and privileged execution.**

The following conclusions survived the V1 falsification pass most strongly:

1. **Model invariants before technology.** Database family, schema shape, partitioning, and consistency are implementation decisions derived from required behavior.
2. **State authority must be explicit.** Every persistent fact and every derived copy needs an owner, writer set, lifecycle, and recovery model.
3. **“ACID” is not a sufficient correctness requirement.** Transaction scope, isolation, conflict behavior, retry behavior, durability assumptions, and external side effects must be stated.
4. **Database constraints are executable integrity controls.** Use them where the database owns the fact and the invariant is expressible; do not rely on race-prone application pre-checks for uniqueness or referential integrity.
5. **Isolation labels hide important anomalies.** Correctness should be reasoned from prohibited histories/invariant violations rather than from a familiar label alone [ISOLEVEL01][ISOLEVEL02].
6. **Serializability and linearizability are different guarantees.** They solve different reasoning problems and must not be conflated [LIN01].
7. **CAP is failure-scoped, not a universal “pick two” architecture rule.** Normal-operation consistency/latency trade-offs and actual product guarantees must also be modeled [CAP01][PACELC01].
8. **Coordination is required by invariants, not by fashion.** Some operations can safely converge without coordination; others cannot [COORD01][CRDT01].
9. **Replication is not backup.** Corruption, malicious mutation, accidental deletion, or bad application logic can be faithfully replicated.
10. **A backup is an unverified hypothesis until restored.** Recovery acceptance must include data integrity, application compatibility, credentials/keys, RPO, and RTO [AWS-BACKUP01].
11. **Migrations are production programs.** They have load, locks, failure, partial-progress, compatibility, replay, and recovery semantics.
12. **Rollback is state-dependent.** Old application code cannot safely return after irreversible state or schema changes it cannot interpret.
13. **Derived stores are not magically consistent.** Caches, search indexes, vector stores, analytics replicas, and materialized views require explicit derivation, freshness, rebuild, and reconciliation contracts.
14. **Multi-tenancy is not one `tenant_id` column or one RLS policy.** Isolation spans identity, authorization, data, compute/resources, operations/control plane, recovery, and lifecycle [AZ-TEN01][PG-RLS01].
15. **No database family is universally best.** Relational, document, key-value, wide-column, graph, time-series, search, vector, analytical, object, and file/block stores optimize different constraints.
16. **Physical design matters after logical correctness.** Indexes, partitioning, compaction, storage layout, and query plans can change latency, cost, availability, and migration behavior without changing the logical model.
17. **Data quality is broader than schema validity.** Accuracy, completeness, consistency, credibility, currentness, accessibility, and related characteristics may need explicit requirements [DQ01].
18. **Criticality determines assurance.** Financial ledgers, identity/authorization data, regulated records, key custody, and irreversible state require stronger independent evidence than disposable analytics or cache state.
19. **Repair is a controlled write path.** Emergency SQL and one-off scripts require the same or stronger safeguards as ordinary application mutations.
20. **The correct objective is minimum total system complexity for the required semantics.** A “simple” database choice that pushes correctness into hidden application code is not actually simple.

---

# 1. How to use this playbook

Use this playbook when designing or changing:

- persistent application state;
- relational or non-relational database schemas;
- transaction boundaries;
- concurrency control;
- replication or distributed consistency;
- storage engine/family selection;
- indexing, partitioning, sharding, or data placement;
- caches or derived read models that affect correctness;
- backup, restore, PITR, archival, or disaster recovery;
- schema or data migrations/backfills;
- pooled, sharded, or dedicated multi-tenant data architecture;
- data repair or reconciliation;
- AI/agent memory or vector stores when they are durable system state.

Use the **Decision layer** before selecting a database or migration mechanism. Use the **Execution layer** for recurring migration, restore, repair, and tenant-movement work. Use the **Assurance layer** to establish why the chosen semantics can be trusted.

Do not use this playbook as:

- a PostgreSQL manual;
- a SQL tutorial;
- a cloud-vendor reference architecture;
- a substitute for security/privacy/legal requirements;
- proof that one database or storage family is “best”;
- a substitute for application/domain understanding.

---

# 2. Inheritance from Playbook 00

This specialist playbook inherits four non-negotiable rules from the Master Playbook Standard [BASE00]:

1. **Outcome before output.**
2. **Evidence before assertion.**
3. **Rigor proportional to consequence, irreversibility, uncertainty, and blast radius.**
4. **Verification and validation before trust.**

It also inherits the Master Standard's normative vocabulary:

- **MUST / MUST NOT** — mandatory within this house standard; deviation requires explicit exception/rationale/owner/risk acceptance.
- **SHOULD / SHOULD NOT** — strong default with context-sensitive exceptions.
- **MAY** — optional mechanism.
- **JUDGMENT REQUIRED** — a competent contextual decision is intentionally not reduced to a fake universal rule.

Claim labels follow Playbook 00:

`REQ`, `EST`, `DEF`, `CTX`, `EMG`, `HOUSE`, `EXP`, `UNK`.

This playbook additionally inherits the engineering master's stronger invariants: explicit state ownership, enforceable invariants, explicit ordering/consistency, bounded failure, tested restoration, and schema/state evolution coupled to recovery [ENG00].

---

# 3. Evidence model and research method

## 3.1 Research design

V2 used a controlled scoping-and-falsification review rather than claiming to be a formal systematic review.

The research sequence was:

```text
DEFINE MATERIAL QUESTIONS
→ MAP CURRENT STANDARDS / AUTHORITATIVE DOCS
→ MAP FOUNDATIONAL DATABASE RESEARCH
→ MAP MATURE OPERATIONAL PRACTICE
→ MAP CONTRADICTIONS / FAILURE MODES
→ VERIFY VERSION STATUS
→ BUILD V1
→ ADVERSARIAL AUDIT
→ CORRECT / BOUND CLAIMS
→ BUILD V2
```

Primary questions:

1. What data-modeling principles survive across storage technologies?
2. Which integrity properties should be enforced structurally?
3. What do transaction and isolation labels actually guarantee?
4. When does concurrency require coordination?
5. How should distributed consistency be specified without CAP slogans?
6. What determines storage family, index, partition, and shard choices?
7. What evidence establishes recoverability?
8. How can live data/schema migrations remain compatible and recoverable?
9. How should tenant isolation be designed and tested?
10. Which rules are universal versus engine/workload-specific?

## 3.2 Evidence lanes

The inherited engineering evidence lanes apply:

- `E0` binding law/contract where scoped;
- `E1` formal/international standard;
- `E2` systematic review/meta-analysis;
- `E3` peer-reviewed or foundational empirical/formal research;
- `E4` government/open consensus specification;
- `E5` mature operational evidence;
- `E6` official platform/protocol documentation;
- `E7` repeated practitioner pattern;
- `E8` opinion/folklore.

No source class automatically outranks another for every question. SQL semantics require standards/engine documentation; anomaly theory requires database research; recovery mechanisms require real engine/cloud semantics; legal retention/deletion requires the applicable law.

## 3.3 Current-status controls at the evidence cutoff

- ISO/IEC 9075-2:2023 remains the published SQL Foundation baseline; Technical Corrigendum 1 was published August 2026. A next edition is under development and is a watch item, not the current baseline [SQL01][SQL-WATCH01].
- ISO/IEC 25012:2008 was reviewed and confirmed in 2025 and remains current [DQ01].
- NIST SP 800-209 remains the published storage-security baseline; Rev. 1 is an Initial Public Draft dated July 2026 and must not be represented as final [NIST-STOR01][NIST-STOR-WATCH01].
- PostgreSQL 18 is the current stable documentation family at cutoff; PostgreSQL 19 Beta 4 was released 24 September 2026 and remains a preview [PG-STATUS01].
- RFC 9562 is the current UUID specification and obsoletes RFC 4122 [UUID01].

---

# 4. Domain model and canonical vocabulary

## 4.1 Fact

A proposition the system treats as true or potentially true about the domain.

Examples:

- customer `C` owns subscription `S`;
- invoice `I` has total `T`;
- object `O` was created at instant `X`.

A fact may be authoritative, derived, historical, inferred, or cached. The category must be knowable when it changes correctness.

## 4.2 Source of truth

The authoritative system/state from which a fact is defined for a specified purpose.

“Source of truth” does not mean “only copy.” It means conflicting copies must resolve according to the declared authority model.

## 4.3 Invariant

A property that must remain true across allowed system states or transitions.

Examples:

```text
invoice.total = sum(valid_invoice_lines)

one_active_subscription_per(customer, product) <= 1

tenant(A).data is never readable through tenant(B) ordinary credentials

ledger_balance = sum(posted_ledger_entries)
```

## 4.4 Transaction

A scoped unit of state transition with defined atomicity, isolation, durability, and error behavior in a particular system.

A local database transaction does not automatically include remote APIs, queues, object stores, emails, payments, or other databases.

## 4.5 Consistency

A family of guarantees about which states/read results can be observed and how replicas/operations relate in time or causality.

The word **consistent** MUST NOT appear as a standalone requirement for a distributed data system; the actual guarantee must be named.

## 4.6 Durability

The promised persistence of committed state under stated failure assumptions.

Durability depends on the actual replication, logging, media, acknowledgement, and recovery design—not on marketing terminology.

## 4.7 Backup

A recoverable copy/history retained for recovery from specified failures. A replica used primarily for availability is not automatically a backup.

## 4.8 Derived store

A store whose content is produced from another authoritative source: cache, search index, vector store, analytical replica, projection, materialized view, denormalized read model, etc.

## 4.9 Tenant

An independently governed customer, organization, workspace, account, or isolation domain whose data/access/resource boundaries matter.

---

# 5. Criticality and assurance

Use the inherited engineering criticality model:

| Level | Data consequence | Default data-assurance posture |
|---|---|---|
| `C0 Experimental` | disposable, synthetic, no material users | lightweight model + explicit non-production status |
| `C1 Ordinary` | recoverable operational inconvenience | constraints, automated tests, backups appropriate to value |
| `C2 Material` | customer/revenue/important operational state | explicit invariant model, migration/restore testing, tenant/security review |
| `C3 High assurance` | major financial, identity, privacy, security, irreversible business impact | independent review, stronger isolation/traceability, restore drills, reconciliation, controlled repair |
| `C4 Safety/mission critical` | severe harm/catastrophic consequence | specialist domain standard, formalized assurance, independent V&V where required |

Raise rigor with:

- irreversibility;
- high write concurrency;
- distributed ownership;
- weak detectability;
- large blast radius;
- regulated/sensitive data;
- cross-tenant consequence;
- long retention;
- expensive recovery;
- autonomous/agent writers;
- weak ability to reconstruct truth after corruption.

---

# 6. Data quality model

ISO/IEC 25012:2008 defines a general structured-data quality model with **15 characteristics** and remains current after review/confirmation in 2025 [DQ01]. This playbook uses that model as a reference, not as a universal scoring formula.

The ISO/IEC 25012 characteristics are:

- **accuracy** — data correctly represents the intended real-world/domain value for the usage context;
- **completeness** — expected entities/attributes have the required values;
- **consistency** — data is free from contradictions against the relevant rules/other data;
- **credibility** — data is regarded as true/believable enough for the usage context;
- **currentness** — data is sufficiently up to date for its use;
- **accessibility** — authorized users/applications can access it under specified conditions;
- **compliance** — data conforms to applicable standards, conventions, or rules;
- **confidentiality** — unauthorized access/disclosure is controlled;
- **efficiency** — data can be processed with appropriate resource/performance behavior;
- **precision** — data has sufficient exactness/granularity for its use;
- **traceability** — origin and relevant transformations can be followed;
- **understandability** — meaning/representation is sufficiently interpretable;
- **availability** — data is obtainable when required under specified conditions;
- **portability** — data can be moved/used across required environments;
- **recoverability** — data can be recovered to an acceptable state.

For production data systems, this playbook additionally uses several **HOUSE/contextual dimensions** because they often change engineering decisions even though they are not separate ISO/IEC 25012 characteristic names:

- **uniqueness / identity integrity** — duplicates are prevented where identity requires uniqueness;
- **validity / domain conformance** — values satisfy the application's explicit domain/schema constraints;
- **relevance / fitness for decision** — retained data is actually suitable for the decision/workflow using it;
- **provenance strength** — material external facts have enough origin/evidence to assess trust;
- **tenant/authorization correctness** — data is visible and mutable only within the intended authority boundary.

**Critical distinction:** structural integrity is not the same as semantic truth. A database can prove that `age >= 0`, that an identifier is unique, and that a foreign key exists; those controls do not prove that the recorded age, identity, or external event is factually correct. Material externally sourced facts therefore need provenance, verification, reconciliation, or stakeholder/process controls appropriate to consequence.

When data feeds consequential analytics or ML, use an analytics/ML-specific data-quality overlay where appropriate; ISO/IEC 5259-2:2024 provides current measures and a model for analytics/ML data quality and explicitly builds on ISO/IEC 25012 and ISO 8000 [MLDQ01]. This specialist playbook owns the storage/integrity interface; AI/ML-specific dataset/evaluation requirements remain with the AI/ML playbook.

Do not collapse quality dimensions into one “data quality score” unless a domain-specific validated reason exists.

For each important measure define:

```yaml
quality_dimension:
population:
definition:
source_or_provenance:
threshold_or_target:
decision_use:
owner:
frequency:
known_bias_or_failure_mode:
```

---

# 7. The Golden Data Standards

The rules below are the V2 root standard. Source IDs indicate strong direct support where applicable; unlabeled implementation details are house synthesis constrained by the surrounding evidence.

## 7.1 Intent, authority, invariants, and ownership

1. **MUST define the domain outcome and unacceptable data failure before selecting a database technology.**
2. **MUST give every material persistent fact an authoritative source or explicit multi-master/conflict model.**
3. **MUST identify authorized writers for material state.**
4. **MUST state material invariants independently of implementation syntax.**
5. **SHOULD make invalid states difficult to persist through schemas, constraints, transaction/state-machine rules, or policy.**
6. **MUST NOT rely on documentation alone for invariants whose violation has material consequence when an enforceable control is practical.**
7. **MUST define lifecycle state for material facts: create, update, derive, archive, retain, delete, restore.**
8. **MUST define whether history is required and whether history itself is authoritative.**
9. **SHOULD keep one canonical representation of each domain rule; duplicated representations require synchronization/reconciliation semantics.**
10. **MUST document assumptions about scale, cardinality, ordering, uniqueness, and freshness when they affect correctness.**
11. **MUST distinguish authoritative state from derived/cache/search/analytics/vector copies.**
12. **MUST define rebuild and reconciliation for material derived stores.**
13. **MUST NOT silently repair an authoritative fact by editing a derived store.**
14. **SHOULD prefer explicit state transitions over unconstrained field combinations for consequential workflows.**
15. **MUST preserve enough provenance to investigate corruption and disputed state at the system's criticality level.**

## 7.2 Modeling, identity, and types

16. **SHOULD model stable domain concepts and relationships before physical tables/collections.**
17. **MUST choose identifiers from lifetime, scope, generation topology, merge/import, privacy, and indexing needs—not fashion.**
18. **MUST define whether an identifier is domain identity, database identity, public identifier, or correlation identifier when ambiguity matters.**
19. **MUST NOT expose database surrogate keys as permanent external identity unless that is a deliberate compatibility decision.**
20. **SHOULD normalize when it prevents contradictory representations of the same fact.**
21. **MAY denormalize when measured access needs justify duplication and source/freshness/reconciliation are explicit.**
22. **MUST NOT treat “schema-less” storage as model-less; the logical model still requires ownership and validation.**
23. **MUST give `NULL`/missing/unknown/not-applicable semantics rather than using ambiguous sentinel values.**
24. **MUST use exact numeric representations where exact equality is required; binary floating point MUST NOT be the sole representation for exact financial values.**
25. **MUST model currency with currency identity and scale/rounding semantics, not a naked numeric amount.**
26. **MUST distinguish time instant, local civil time, timezone, date, duration, and business calendar where relevant.**
27. **MUST NOT use wall-clock timestamp order as proof of causal or commit order without an actual guarantee.**
28. **MUST define wire-format precision for large integers; common JSON/JavaScript consumers may not preserve arbitrary 64-bit integer precision [JSON01].**
29. **MAY use UUIDv7 when distributed uniqueness plus time-ordered locality is useful; MUST NOT infer causality from UUIDv7 time fields [UUID01].**
30. **SHOULD avoid storing the same semantic value in multiple incompatible units/formats without canonical conversion rules.**

## 7.3 Integrity and constraints

31. **MUST enforce uniqueness at the authoritative write boundary when duplicates violate an invariant.**
32. **SHOULD use database UNIQUE/PRIMARY KEY constraints rather than application “check then insert” when one database owns the fact.**
33. **SHOULD use FOREIGN KEY or equivalent referential enforcement inside one authoritative relational boundary when orphaned references are invalid.**
34. **MAY omit database referential constraints only with explicit ownership, deletion, reconciliation, and failure controls.**
35. **SHOULD use CHECK/domain/type constraints for stable row-local invariants the engine can enforce safely.**
36. **MUST NOT assume a check constraint can safely enforce arbitrary cross-row or cross-system invariants.**
37. **MUST decide cascade/restrict/set-null/delete semantics from domain lifecycle, not convenience.**
38. **MUST test uniqueness and referential invariants under concurrent writers.**
39. **SHOULD add reconciliation for high-consequence integrity that can be violated by external systems, imports, privileged repair, or bugs outside ordinary constraints.**
40. **MUST make privileged/bulk import paths meet the same invariant outcome or explicitly quarantine/reconcile before promotion.**

## 7.4 Transactions and external side effects

41. **MUST define the transaction boundary from the invariant being protected.**
42. **MUST state actual transaction scope; “inside a request” is not a transaction specification.**
43. **MUST NOT assume a local database transaction covers remote side effects.**
44. **SHOULD keep transactions bounded in time and resource usage.**
45. **SHOULD avoid remote network calls while holding database locks/transactions unless the correctness benefit justifies the failure/latency cost.**
46. **MUST define retry semantics for aborted/deadlocked/serialization-failed transactions where the engine can produce them.**
47. **MUST retry the complete logical transaction when partial retry could violate the invariant.**
48. **MUST make externally retried side effects idempotent/deduplicated or otherwise prove duplicate safety.**
49. **MUST define timeout/cancellation behavior for transactions or workflows that can wait on locks/resources.**
50. **MUST bound transaction retries; infinite retry is not a recovery policy.**
51. **SHOULD use transactional outbox/inbox or equivalent when a local state change and asynchronous message publication must not silently diverge.**
52. **MUST treat a saga as compensating workflow, not as equivalent to atomic rollback [SAGA01].**
53. **MAY use two-phase/consensus-based commit when true cross-resource atomicity is required and its blocking/coordination/failure characteristics are acceptable [COMMIT01].**
54. **MUST define reconciliation for any workflow that can partially succeed across independent systems.**
55. **MUST record whether an external side effect can be observed before the local state transition is final.**

## 7.5 Isolation and concurrency

56. **MUST choose isolation from prohibited anomalies/invariant failures, not by habit.**
57. **MUST NOT treat Read Committed, Repeatable Read, Snapshot Isolation, or Serializable as interchangeable [ISOLEVEL01][ISOLEVEL02].**
58. **MUST consider write skew when concurrent transactions make decisions from overlapping snapshots.**
59. **MUST consider lost update when clients perform read-modify-write sequences.**
60. **MUST consider phantom/predicate races when invariants depend on set membership or counts.**
61. **SHOULD use atomic conditional writes/compare-and-set when a version predicate directly expresses the required conflict rule.**
62. **SHOULD use pessimistic locking when conflict must be serialized and lock cost/deadlock risk are acceptable.**
63. **SHOULD use optimistic concurrency when conflicts are uncommon and failures can be safely detected/retried.**
64. **MUST define lock ownership, wait/timeout, deadlock/retry, and cancellation for explicit locking.**
65. **SHOULD use serializable execution when weaker semantics cannot be proven safe and the consequence justifies stronger coordination.**
66. **MUST expect serialization failures/aborts where the chosen implementation uses them for correctness; the caller must handle them [PG-TXN01].**
67. **MUST test concurrency with overlapping execution rather than only sequential unit tests.**
68. **MUST test the invariant outcome, not merely the absence of exceptions.**
69. **MUST NOT use “last write wins” unless losing one of the concurrent values is an explicitly acceptable domain outcome.**
70. **MUST make automated/agent writers obey the same concurrency and idempotency contract as human-facing application writers.**

## 7.6 Distributed consistency, replication, and conflict

71. **MUST name the observable consistency guarantee required by material operations.**
72. **MUST distinguish serializability from linearizability; one orders transactions, the other constrains real-time operation visibility [LIN01].**
73. **MUST NOT use CAP as a generic “pick two” rule; state partition behavior and ordinary-operation trade-offs explicitly [CAP01][PACELC01].**
74. **MUST define read-your-writes requirements where users/operators expect immediate visibility.**
75. **MUST define acceptable replica staleness and lag for reads from replicas.**
76. **MUST define conflict resolution for multi-writer or offline replicated state.**
77. **MUST NOT use timestamp-based conflict resolution without accepting clock/order and lost-update consequences.**
78. **MAY use CRDTs for data types whose merge semantics preserve the required outcome; MUST NOT infer that arbitrary invariants become coordination-free [CRDT01][COORD01].**
79. **MUST define replication acknowledgement/durability semantics for states whose loss matters.**
80. **MUST monitor material replication lag and replica health.**
81. **MUST define failover/failback and split-brain prevention/detection where replicated leaders exist.**
82. **MUST prove that unique or scarce-resource invariants survive partition/failover behavior.**
83. **SHOULD prefer scoped stronger guarantees for operations that require them instead of over-strengthening unrelated workload.**
84. **MUST define rejoin/resynchronization semantics after an offline or divergent replica returns.**
85. **MUST reconcile after conflicts/failover when the engine or application can produce divergent accepted state.**

## 7.7 Partitioning, sharding, and placement

86. **MUST NOT shard solely because “scale” is anticipated; define the actual capacity, isolation, geography, or ownership constraint.**
87. **MUST distinguish table/collection partitioning from independent database/service sharding.**
88. **MUST choose shard/partition keys from access locality, distribution, hotspot risk, transaction scope, and resharding requirements.**
89. **MUST test cardinality/skew assumptions with representative data.**
90. **MUST avoid shard keys that concentrate time-ordered or dominant-tenant writes unless the engine/topology is designed for that concentration.**
91. **MUST define cross-shard query and transaction behavior.**
92. **MUST define resharding/rebalancing before scale makes the initial layout irreversible.**
93. **MUST make tenant movement between shards/databases resumable and verifiable.**
94. **MUST define data residency/region placement as an explicit constraint where it applies.**
95. **SHOULD preserve placement metadata in a durable control plane with audit history when dynamic routing is used.**

## 7.8 Storage and access paths

96. **MUST choose storage family from data shape, access patterns, transaction/consistency needs, scale, latency, retention, operations, portability, and cost.**
97. **MUST NOT claim SQL or NoSQL is inherently more scalable; specific architectures and workload semantics decide.**
98. **SHOULD prefer one store when it meets requirements adequately; add specialized stores only when benefits exceed synchronization and operational cost.**
99. **MUST define authoritative vs derived status for every specialized store.**
100. **MUST choose indexes from real predicates, joins, sort/order, selectivity, and access patterns.**
101. **MUST account for write/storage/maintenance cost of indexes.**
102. **MUST verify important access paths with actual query plans/runtime evidence.**
103. **SHOULD remove indexes whose cost is material and whose decision-relevant use is absent.**
104. **MUST understand build/rebuild lock, I/O, WAL/log, and replication effects for material indexes.**
105. **SHOULD treat B-tree, LSM, hash, inverted, spatial, and vector indexes as different workload tools, not interchangeable performance switches [BTREE01][LSM01].**
106. **MUST monitor compaction/write amplification where LSM-oriented stores can create latency/capacity cliffs.**
107. **MUST define row-vs-column analytical layout from scan/selectivity/update workload rather than trend.**
108. **MUST preserve schema/format compatibility for long-lived files and analytical artifacts; optional/preview format features require ecosystem support verification [PARQUET01].**
109. **MUST bound object/file retention, versioning, and delete behavior where storage cost or privacy matters.**
110. **MUST include storage encryption keys/configuration in recovery dependency analysis.**

## 7.9 Backup, restore, and corruption recovery

111. **MUST define RPO and RTO where data loss or restoration delay has material consequence.**
112. **MUST identify recovery failure scenarios: operator deletion, application corruption, malicious destruction, region/service failure, credential/key loss, and dependency loss as relevant.**
113. **MUST NOT treat replication as the sole recovery mechanism against logical corruption or malicious mutation.**
114. **MUST separate recovery copies from the same failure domain when the threat model requires it.**
115. **SHOULD use immutability/offline or independently controlled retention where destructive compromise is material [NIST-STOR01][CISA-BACKUP01].**
116. **MUST inventory required recovery state beyond database bytes: schema, config, keys, credentials, routing, object data, queues/logs, and external references as applicable.**
117. **MUST periodically perform a restore test for material data [AWS-BACKUP01].**
118. **MUST validate restored data, not merely complete the restore command.**
119. **MUST validate application compatibility and critical user journeys against the restored state.**
120. **MUST measure achieved RPO/RTO during recovery tests when those objectives exist.**
121. **MUST define point-in-time recovery dependencies and granularity when continuous log/WAL recovery is used [PG-BACKUP01].**
122. **MUST retain enough history to recover from corruption that is detected later than the most recent backup interval when the risk justifies it.**
123. **MUST define authority for declaring recovered state acceptable.**
124. **MUST preserve forensic/audit evidence before destructive repair when security/compliance/incident needs require it.**
125. **MUST treat repair scripts as controlled production changes with dry-run/bounds/audit/reconciliation.**

## 7.10 Schema evolution, migration, and backfill

126. **MUST design live schema evolution for version coexistence.**
127. **SHOULD prefer expand → compatible readers/writers → migrate → verify → switch → stop old path → contract.**
128. **MUST classify migration risk by lock strength, rewrite/scan, I/O/WAL/log amplification, duration, transaction size, and rollback limits for the actual engine/version.**
129. **MUST NOT assume “additive” means operationally cheap.**
130. **MUST rehearse high-risk migrations with representative schema/data volume and concurrency.**
131. **MUST define migration stop/abort criteria.**
132. **MUST make long backfills resumable.**
133. **SHOULD make backfills idempotent or checkpointed so partial completion is safe.**
134. **MUST rate/batch backfills where they can affect production load.**
135. **MUST observe lock waits, query latency, replication lag, storage/log growth, error rate, and relevant domain SLOs during material backfills.**
136. **MUST reconcile migrated data before deleting the old representation.**
137. **MUST prove that old application versions cannot write incompatible state before contract/destructive migration.**
138. **MUST delay destructive drops/removals until usage evidence supports removal.**
139. **MUST co-design rollback/roll-forward with state compatibility.**
140. **MUST use roll-forward when rollback would reintroduce incompatible readers/writers or amplify corruption.**
141. **MUST version fleet migrations for database-per-tenant/sharded deployments.**
142. **MUST quarantine failed tenant/database cohorts rather than pretending a partial fleet migration is complete.**
143. **MUST record migration provenance: version, code/artifact, parameters, start/end, affected scope, result, reconciliation.**
144. **MUST treat manual production DDL as an exception path subject to equivalent audit and verification.**
145. **MUST remove temporary dual-write/compatibility mechanisms after convergence to avoid permanent divergent truth paths.**

## 7.11 Multi-tenancy

146. **MUST define tenant isolation requirements before selecting pooled vs dedicated storage.**
147. **MUST treat isolation as a spectrum across multiple planes [AZ-TEN01].**
148. **MUST independently reason about identity, authorization, data, compute/resource, operations/control-plane, recovery, and lifecycle isolation.**
149. **MUST resolve tenant identity from a trusted authenticated context; MUST NOT trust an arbitrary client-supplied `tenant_id` as authorization.**
150. **MUST make tenant scope structural in pooled data models where omission could expose another tenant.**
151. **SHOULD include tenant identity in relevant pooled uniqueness and referential keys.**
152. **MUST prevent accidental cross-tenant joins/relationships unless explicitly authorized.**
153. **SHOULD use row-level security or equivalent as defense in depth when it improves structural isolation, but MUST test privileged bypass semantics [PG-RLS01].**
154. **MUST separate ordinary tenant access from privileged support/admin/break-glass access.**
155. **MUST audit privileged cross-tenant access at the level justified by consequence.**
156. **MUST test ordinary, privileged, background-job, migration, export, restore, and analytics paths for tenant isolation.**
157. **MUST define noisy-neighbor protection where shared resources can violate tenant SLOs [AZ-TEN01].**
158. **MUST monitor per-tenant or isolation-domain usage when capacity/fairness decisions require it.**
159. **MUST define per-tenant backup/restore expectations and whether recovery granularity matches them.**
160. **MUST define tenant export/offboarding/deletion across primary, replicas, backups, caches, search, vectors, analytics, and object stores where applicable.**
161. **MUST define encryption-key and geographic-placement isolation where tenant requirements demand it.**
162. **MUST automate onboarding, placement, migration, and offboarding when tenant count makes manual operation unsafe [AZ-TEN01].**
163. **MUST avoid bespoke per-tenant schema variants without an explicit product requirement and fleet lifecycle strategy.**
164. **MUST define data movement semantics when a tenant changes tier, region, shard, or dedicated/pooled topology.**
165. **MUST verify that tenant movement is complete before changing routing authority.**

## 7.12 Lifecycle, retention, observability, and repair

166. **MUST define retention/deletion rules for material data.**
167. **MUST account for replicas, backups, derived stores, exports, logs, and archives in deletion/retention design.**
168. **MUST make archival semantics explicit: archived does not mean deleted and deleted does not imply unrecoverable until all scoped copies expire.**
169. **MUST define tombstone/soft-delete semantics if used, including uniqueness, query, retention, restore, and privacy effects.**
170. **MUST NOT use soft delete by default without an actual recovery/audit/product requirement.**
171. **MUST monitor transaction failures, deadlocks/lock waits, slow query distributions, replication lag, backup/restore health, storage growth, migration progress, and data-quality signals where material.**
172. **MUST monitor derived-store freshness/reconciliation drift where users rely on it.**
173. **MUST monitor tenant resource skew/noisy-neighbor signals in shared systems.**
174. **MUST monitor checksum/corruption signals where the platform exposes meaningful checks.**
175. **MUST correlate material data incidents with deployment/config/migration versions.**
176. **MUST define a controlled data-repair path with authorization, scope limits, dry-run where feasible, audit, verification, and rollback/compensation strategy.**
177. **MUST reconcile after repair rather than assuming the mutation succeeded correctly.**
178. **MUST preserve before/after evidence for high-consequence repairs.**
179. **MUST learn from data incidents by changing controls, not merely documenting operator error.**
180. **MUST retire unused schemas, tables, indexes, buckets, replicas, credentials, and compatibility code deliberately to reduce cost and attack/change surface.**

## 7.13 Second-pass assurance amendments

181. **MUST distinguish structural validity/integrity from semantic accuracy or real-world truth; constraints cannot prove facts they do not observe.**
182. **MUST preserve or reconstruct provenance for material externally sourced facts when source trust can change a consequential decision.**
183. **MUST verify mixed-version schema/application compatibility during online evolution; “additive” syntax alone is not proof that concurrent old/new writers are semantically compatible [MIG01].**
184. **MUST identify a last-known-good recovery point after suspected corruption/ransomware before restoring; blindly restoring the latest copy can faithfully reintroduce bad state [NIST-REC01][NIST-DETECT01].**
185. **SHOULD use checksums, scrubbing, redundant verification, or equivalent end-to-end integrity controls when silent corruption consequence justifies them and the platform provides meaningful mechanisms [SDC01].**
186. **MUST version, cohort, observe, and quarantine fleet migrations across sharded/database-per-tenant estates so partial success cannot be mistaken for convergence [MIG02].**
187. **SHOULD apply an analytics/ML data-quality overlay when consequential models or analytics consume the data; generic database integrity alone is insufficient [MLDQ01].**
188. **MUST use current stable/minor vendor documentation for engine-specific operational claims and MUST NOT promote beta, draft, or preview behavior into the stable baseline [PG-STATUS01][NIST-STOR-WATCH01][SQL-WATCH01].**

---

# 8. Data modeling standard

## 8.1 Canonical data contract

For each material entity/aggregate/fact group, record enough of:

```yaml
name:
domain_purpose:
authoritative_source:
owner:
identity:
tenant_scope:
writers:
readers:
classification:
fields_and_semantics:
relationships:
invariants:
state_transitions:
history_semantics:
consistency_required:
freshness_required:
retention:
deletion:
backup_recovery:
derived_copies:
expected_scale:
critical_queries:
criticality:
```

Do not force every low-risk table into a document. The purpose is to expose the material semantics.

## 8.2 Entity vs event vs observation

Distinguish:

- **entity state** — current authoritative condition;
- **event** — something that occurred;
- **observation** — evidence/measurement about a world/system state;
- **command/request** — intent to cause change;
- **derived projection** — computed representation.

Confusing these categories creates hidden mutation and audit problems.

Example:

```text
"PaymentRequested" ≠ "PaymentSucceeded"
"EmailSent" should not be recorded before the provider outcome is known
"AccountBalance" can be derived from ledger entries but may also be materialized
```

## 8.3 Normalization

Normalization is primarily an integrity and dependency tool, not a moral requirement.

Prefer stronger normalization when:

- one fact is being represented in multiple places;
- update anomalies are plausible;
- transactionally consistent joins are affordable and required;
- data ownership is inside one relational boundary.

Denormalization becomes more defensible when:

- measured read paths dominate;
- distributed ownership makes joins operationally expensive;
- analytical scans need a different layout;
- derived state can tolerate and expose staleness;
- the rebuild/reconciliation path is known.

## 8.4 Structured columns vs JSON/document payloads

Use structured columns/fields when:

- constraints and type semantics matter;
- fields are frequently filtered/joined/sorted;
- schema evolution needs discoverability;
- reporting/query tools depend on them.

Use JSON/document payloads when:

- records are naturally aggregate/document-shaped;
- sparse/extensible attributes are real;
- fields evolve independently and strict relational decomposition adds more complexity than value;
- the engine still provides adequate validation/index/query behavior for material fields.

Do not use a generic JSON blob to avoid modeling.

---

# 9. Identity, keys, nullability, numbers, and time

## 9.1 Key decision

Evaluate:

| Factor | Natural/domain key | Surrogate key |
|---|---|---|
| Domain-stable identity | strong fit | may duplicate identity |
| Mutable real-world identifier | risky as PK | strong fit |
| Composite uniqueness | possible | use unique constraint separately |
| Sensitive identifier | may leak | surrogate can reduce exposure |
| Distributed generation | depends | UUID/sequence/other strategies |
| Merge/import across systems | collision semantics required | global ID can help |
| Index locality | value-dependent | ordered strategies can help |

A surrogate primary key does **not** eliminate the need for a domain unique constraint when the domain says duplicates are invalid.

## 9.2 UUIDs

RFC 9562 defines UUID versions including UUIDv7 [UUID01].

Use UUIDv7 when you need globally distributed generation plus time-ordered locality and the metadata leakage is acceptable.

Do not claim:

- UUIDv7 defines causal order;
- UUIDs eliminate collision analysis entirely;
- every database benefits from the same key layout.

## 9.3 Large integers on APIs

If an identifier can exceed the exact integer range commonly preserved by JSON/JavaScript consumers, encode a safe interoperable representation such as a string or explicitly supported big-integer contract [JSON01].

## 9.4 Presence semantics

Distinguish:

```text
UNKNOWN
ABSENT / NOT PROVIDED
NOT APPLICABLE
EMPTY
ZERO
FALSE
DELETED
```

Do not collapse these into one sentinel when decisions depend on the difference.

## 9.5 Money

A robust money model normally includes:

```yaml
amount:
currency:
scale_or_minor_unit_policy:
rounding_rule:
tax_rounding_context:
exchange_rate_source_if_applicable:
rate_timestamp_if_applicable:
```

Never silently compare amounts from different currencies.

## 9.6 Temporal data

Choose representations from semantics:

- **instant** — an absolute point in time;
- **local datetime + timezone/zone rule** — scheduled civil intent;
- **date** — calendar date without time;
- **duration** — elapsed amount;
- **business period** — domain-defined interval;
- **effective_from/effective_to** — validity interval;
- **recorded_at** — system observation time.

A recurring meeting at “09:00 Europe/Copenhagen” cannot be modeled faithfully as one UTC clock time independent of daylight-saving changes.

---

# 10. Integrity engineering

## 10.1 Integrity layers

Use the strongest authoritative layer that can actually guarantee the property:

```text
TYPE / VALUE DOMAIN
→ SCHEMA CONSTRAINT
→ TRANSACTION / CONCURRENCY CONTROL
→ STATE MACHINE
→ AUTHORIZATION / POLICY
→ CROSS-SYSTEM WORKFLOW / COORDINATION
→ RECONCILIATION / AUDIT
```

Defense in depth is justified when consequence is high.

## 10.2 Example invariant mapping

| Invariant | Strong control candidates |
|---|---|
| email unique within tenant | `UNIQUE(tenant_id, normalized_email)` |
| order line references existing order | FK inside same DB authority |
| one active reservation for resource/time | exclusion/unique strategy, serializable/predicate locking, or domain allocator |
| balance equals posted ledger sum | append rules + transaction + reconciliation |
| quota never exceeded | atomic conditional update / serializable allocation / centralized quota authority |
| tenant B cannot read tenant A | authz + tenant-scoped keys/policies + RLS/physical isolation + negative tests |

## 10.3 Reconciliation

Reconciliation is required when:

- integrity spans systems without one atomic boundary;
- privileged/import paths bypass normal constraints;
- data is derived asynchronously;
- external providers have independent truth;
- corruption can escape normal enforcement.

A reconciliation job MUST define:

```yaml
authority:
comparison_population:
matching_key:
tolerance:
frequency:
failure_severity:
automatic_repair_allowed:
manual_review_threshold:
audit_evidence:
```

---

# 11. Transaction engineering

Classical transaction/recovery research formalized the importance of atomic state transition and recovery discipline; modern systems differ in implementation, but the requirement to define what commit and recovery actually mean remains [TXN01].

## 11.1 Transaction contract

For every material transaction pattern:

```yaml
name:
business_invariant:
authoritative_store:
read_set_or_predicate:
write_set:
isolation:
expected_conflicts:
external_side_effects:
idempotency_key:
retry_conditions:
retry_limit:
deadline:
error_semantics:
observability:
```

## 11.2 Keep the invariant inside the transaction when possible

Weak:

```text
SELECT availability
→ commit/end request
→ later INSERT reservation
```

Stronger patterns include:

- one transaction with appropriate locks/isolation;
- atomic conditional update;
- unique/exclusion constraint;
- serializable predicate transaction;
- dedicated allocator with explicit authority.

## 11.3 External side effects

A database rollback cannot unsend an email or reverse a payment merely because the call happened inside the application function.

Choose explicitly:

- **state first + outbox** → commit local state and durable intent atomically, publish later;
- **external first + idempotent completion** → useful only when external operation can be safely deduplicated/reconciled;
- **saga** → sequence with compensations and explicit irreversibility [SAGA01];
- **distributed commit** → when infrastructure truly provides the required atomicity and cost is justified [COMMIT01].

Do not implement a naive dual write and call the two calls “one transaction.”

---

# 12. Isolation and concurrency engineering

## 12.1 Why names are not enough

Berenson et al. showed ambiguity in classic ANSI isolation phenomena and formalized Snapshot Isolation as an important multiversion model; Adya et al. developed more implementation-independent definitions [ISOLEVEL01][ISOLEVEL02].

The engineering implication is not “ignore SQL isolation levels.” It is:

> **Map business invariants to the histories/anomalies they must exclude, then verify the actual engine behavior.**

## 12.2 Anomaly decision table

| Risk | Example | Typical controls |
|---|---|---|
| dirty read | read uncommitted temporary value | stronger isolation |
| lost update | two clients overwrite same version | CAS/version, lock, serializable |
| non-repeatable read | later read sees changed row | repeatable snapshot/lock |
| phantom/predicate race | two tx both see “none exists” | unique/exclusion, predicate/serializable |
| write skew | tx update disjoint rows based on shared predicate | serializable/coordination/invariant redesign |
| duplicate effect | retry repeats charge/order | idempotency/dedup |
| stale replica read | user writes then reads old replica | primary/session consistency/read-your-writes route |

## 12.3 PostgreSQL example boundary

PostgreSQL 18 documents Read Committed, Repeatable Read, and Serializable behavior; its Serializable implementation can abort transactions when serialization safety cannot be established, requiring retry of the transaction [PG-TXN01]. PostgreSQL's explicit-lock documentation is also a useful reminder that lock modes, conflicts, and DDL lock behavior are engine-specific contracts that must be checked rather than guessed [PG-LOCK01].

This is an **implementation example**, not a universal reason every application should use PostgreSQL or Serializable.

## 12.4 Optimistic vs pessimistic

Use optimistic control when:

- conflicts are infrequent;
- version checking is cheap;
- retry is safe;
- holding locks would hurt latency/capacity.

Use pessimistic control when:

- conflicting operations are expected;
- violation cannot be tolerated;
- bounded blocking is preferable to repeated abort/retry;
- lock scope can be understood and observed.

Use constraints/atomic operations when the invariant can be expressed more directly than either pattern.
# 13. Distributed consistency and replication

## 13.1 Consistency vocabulary

Use exact terms where they matter:

- **serializability** — committed transaction outcome is equivalent to some serial execution;
- **strict serializability** — serializability plus real-time ordering constraints;
- **linearizability** — each concurrent operation appears to take effect atomically between invocation and response [LIN01];
- **snapshot isolation** — transactions read from a consistent snapshot with defined write-conflict rules; can permit write skew [ISOLEVEL01];
- **causal consistency** — causally related operations are observed in causal order;
- **eventual convergence/consistency** — replicas converge under stated update-delivery/conflict assumptions;
- **read-your-writes** — a client/session can observe its own accepted write;
- **monotonic reads** — a client does not go backward to older observed state.

Do not write “strong consistency” without defining the actual observable guarantee.

## 13.2 CAP and PACELC

Gilbert and Lynch formalized the CAP trade-off under partitions in an asynchronous network model [CAP01]. Abadi's PACELC framing emphasizes that distributed systems also make latency/consistency choices during normal operation [PACELC01].

Bad decision statement:

> We chose availability over consistency because CAP.

Better:

> During a partition, checkout remains available for catalog reads up to 5 minutes stale, but allocation of scarce inventory requires the authoritative region and may reject/become unavailable rather than oversell. Outside partitions, catalog replicas may trade bounded freshness for local latency.

## 13.3 Coordination avoidance

Bailis et al. show that application invariants determine whether coordination is necessary; serializable execution is sufficient for many correctness properties but not necessary for all [COORD01].

Operational rule:

1. define the invariant;
2. determine whether independent updates can merge without violating it;
3. coordinate only the operations/invariants that require coordination;
4. verify the claimed coordination-free behavior with adversarial histories.

## 13.4 CRDTs

CRDTs provide mathematically defined convergence for suitable replicated data types [CRDT01].

Strong use cases can include:

- grow-only or add/remove sets with defined semantics;
- counters with commutative updates;
- replicated metadata where conflicts have domain-valid merge rules.

Weak use cases include scarce allocation, financial invariants, or mutually exclusive state where “merge both” violates the domain.

## 13.5 Replication contract

For material replication define:

```yaml
authority_or_leader_model:
replication_mode:
acknowledgement_rule:
read_routing:
staleness_or_lag_bound:
failover:
failback:
split_brain_control:
conflict_resolution:
rejoin_sync:
data_loss_assumption:
observability:
```

Replication increases availability/durability only under the failures it actually isolates.

Mature distributed systems demonstrate that very different guarantee sets can be valid for different outcomes: Dynamo deliberately sacrificed consistency under some failures for availability and surfaced application-assisted conflict resolution [DYN01], while Spanner demonstrated globally distributed synchronous replication with externally consistent transactions using an explicit clock-uncertainty design [SPANNER01]. These are evidence that the trade-space is real—not templates to copy mechanically.

---

# 14. Partitioning, sharding, and data placement

## 14.1 Partitioning decision

Partition when it materially improves:

- lifecycle/retention management;
- pruning/query performance;
- bulk load/drop;
- maintenance scope;
- operational isolation.

Do not partition because a table is “large” without a measured access/maintenance reason.

## 14.2 Sharding decision

Sharding is a distributed architecture decision. Justifications include:

- single-node capacity limit;
- write/read throughput beyond one authority;
- tenant/failure isolation;
- geography/residency;
- organizational ownership.

Costs include:

- cross-shard transactions;
- global uniqueness;
- resharding;
- fan-out queries;
- backup/recovery coordination;
- placement metadata;
- operational fleet complexity.

## 14.3 Shard-key checklist

Before accepting a shard key:

- [ ] cardinality supports desired distribution;
- [ ] dominant tenants/keys do not create unacceptable hotspots;
- [ ] primary query paths can locate shard without broad fan-out where needed;
- [ ] required transactions are mostly local or cross-shard semantics are explicit;
- [ ] future resharding is possible;
- [ ] region/residency constraints are preserved;
- [ ] key evolution/tenant movement is supported;
- [ ] failure/restore blast radius is acceptable.

---

# 15. Storage family selection

## 15.1 Selection sequence

```text
DOMAIN INVARIANTS
→ TRANSACTION / CONSISTENCY
→ ACCESS PATTERNS
→ DATA SHAPE / VOLUME
→ LATENCY / THROUGHPUT
→ RETENTION / LIFECYCLE
→ AVAILABILITY / RECOVERY
→ SECURITY / TENANCY
→ OPERATIONS / TEAM CAPABILITY
→ PORTABILITY / EXIT
→ COST
→ TECHNOLOGY
```

## 15.2 Decision table

| Family | Strong fit | Main design burdens |
|---|---|---|
| relational | constraints, transactions, joins, ad-hoc queries | schema evolution, coordination, partition topology |
| key-value | simple primary-key reads/writes, scalable partitioning | secondary access, cross-key invariants |
| document | aggregate-shaped records, flexible nested structure | cross-document constraints, schema drift |
| wide-column | high write scale, sparse/time-oriented keyed access | access-pattern-first modeling, compaction, cross-row semantics [BIGTABLE01] |
| graph | relationship traversal/path queries | operational specialization, distributed traversal |
| time-series | append/time-window query, retention/downsampling | high-cardinality labels, aggregation semantics |
| search | full-text/ranking/filtering | derived-state freshness, relevance/versioning |
| vector | similarity retrieval | embedding/model provenance, approximate recall, index rebuild |
| analytical columnar | scans/aggregation, compressed historical data | update latency, governance/schema compatibility |
| object storage | durable blobs/large immutable objects | object/database linkage, lifecycle/versioning |
| file/block storage | filesystem/block semantics, legacy/storage workloads | mounting/concurrency/snapshot/security semantics |

## 15.3 Polyglot persistence gate

Add a second authoritative-capable store only if:

- it solves a material requirement the current store cannot meet adequately;
- ownership is clear;
- cross-store consistency is specified;
- backup/recovery covers both;
- migrations/deprecation are affordable;
- the team can operate it;
- failure can be diagnosed.

A second store that only moves complexity from queries into synchronization may be a net loss.

---

# 16. Physical storage, files, and analytical formats

## 16.1 Block, file, and object

Treat storage substrate as part of the failure model.

Ask:

- what is the atomic write unit?
- what acknowledgement means durable?
- what snapshot semantics exist?
- can snapshots be crash-consistent vs application-consistent?
- what corruption detection exists?
- how are keys/access policies recovered?
- what happens on partial/network failure?
- what are lifecycle/version/delete semantics?

NIST SP 800-209 provides security guidance for storage infrastructure; at cutoff the 2020 publication is the final baseline while Rev. 1 is still an Initial Public Draft [NIST-STOR01][NIST-STOR-WATCH01].

## 16.2 Columnar file formats

Columnar formats such as Apache Parquet optimize analytical column access and maintain format/version compatibility concerns [PARQUET01].

For long-lived analytical files define:

- schema evolution rules;
- field IDs/names and rename behavior;
- null/default semantics;
- timestamp/timezone semantics;
- compression/codecs;
- reader ecosystem/version support;
- encryption if used;
- file-size/row-group policy;
- partitioning layout;
- compaction/small-file strategy;
- retention and catalog metadata.

Do not adopt preview format features until required readers/writers support them.

---

# 17. Index engineering

## 17.1 Index contract

For each material index:

```yaml
name:
query_or_constraint_served:
columns_or_expression:
ordering:
predicate_if_partial:
included_payload:
expected_selectivity:
read_benefit:
write_cost:
storage_cost:
build_behavior:
maintenance_or_compaction:
monitoring:
removal_trigger:
```

## 17.2 B-tree and LSM boundaries

B-tree research established balanced ordered indexing for efficient search/update [BTREE01]. LSM-tree research introduced a write-oriented hierarchy that can transform random writes into sequential/batched work at the cost of compaction/read amplification trade-offs [LSM01].

Engineering implication:

- B-tree vs LSM is not “SQL vs NoSQL”;
- the engine may use both or variants;
- workload and implementation details determine the practical result.

## 17.3 Index review

Review an index when:

- query mix changes;
- cardinality/skew changes;
- write throughput increases;
- storage cost becomes material;
- a migration adds overlapping indexes;
- query plans stop using it;
- compaction/vacuum/maintenance burden grows.

---

# 18. Query and data-access performance

Performance must be workload-specific.

Define:

```yaml
critical_query_or_operation:
population:
latency_percentile_target:
throughput:
concurrency:
data_volume:
selectivity:
result_size:
freshness:
transaction_isolation:
tenant_distribution:
cold_warm_cache_state:
```

Use:

- query plans;
- runtime statistics;
- lock/wait analysis;
- I/O/CPU/memory evidence;
- representative data distributions;
- p95/p99/tail behavior when relevant.

Avoid:

- optimizing one query while degrading write path globally;
- adding caches before defining staleness/invalidation;
- using average latency as the only signal;
- benchmarking with tiny synthetic data whose cardinality/selectivity differs from production.

---

# 19. Caches and derived stores

## 19.1 Derived-state contract

Every material derived store should declare:

```yaml
authoritative_source:
derivation_logic:
update_transport:
freshness_target:
staleness_tolerance:
ordering_assumption:
duplicate_handling:
rebuild:
reconciliation:
delete_propagation:
tenant_isolation:
schema_model_version:
failure_behavior:
```

## 19.2 Caches

Before caching define:

- key;
- source of truth;
- TTL/freshness;
- invalidation;
- stampede/herd control if needed;
- miss behavior;
- stale-read behavior;
- tenant boundary;
- privacy/classification;
- rebuild/flush behavior.

Do not make correctness depend on an undocumented cache warm state.

## 19.3 Search indexes

Search engines are often derived read models. Direct mutation of search state should normally be prohibited unless that store is explicitly authoritative.

Define:

- source event/version;
- indexing lag;
- reindex/rebuild;
- delete propagation;
- query behavior during reindex;
- ranking/model version if relevant.

## 19.4 Vector stores and embeddings

Treat embeddings as derived data with model/version provenance.

Record:

```yaml
source_object_id:
source_version:
embedding_model:
model_version_or_digest:
chunking_strategy:
embedding_created_at:
tenant_scope:
retention:
rebuild_policy:
```

Do not assume a vector result is current merely because retrieval succeeds.

---

# 20. Backup architecture

## 20.1 Recovery-first design

Start from unacceptable loss, not a backup product.

```text
FAILURE SCENARIO
→ REQUIRED LAST-KNOWN-GOOD STATE
→ RPO
→ REQUIRED SERVICE RESTORATION
→ RTO
→ COPY / LOG / SNAPSHOT STRATEGY
→ INDEPENDENT FAILURE DOMAIN
→ RESTORE PROCEDURE
→ VALIDATION
→ EXERCISE
```

## 20.2 Backup methods

Potential mechanisms:

- logical dump/export;
- physical snapshot/image;
- continuous log/WAL archiving;
- incremental backup;
- object/version history;
- application-level export;
- provider-managed backup.

Each has different consistency, granularity, speed, portability, and recovery assumptions.

PostgreSQL 18, for example, documents SQL dump, file-system-level backup, and continuous archiving/PITR as distinct approaches [PG-BACKUP01]. That does not make the PostgreSQL menu universal; it illustrates why “we have backups” is too vague.

## 20.3 Failure-domain independence

A recovery design should ask whether the backup can survive:

- deletion of the primary;
- compromised admin credentials;
- ransomware/destructive write;
- provider/account failure;
- regional failure;
- encryption-key loss;
- corrupted application logic;
- delayed discovery.

CISA ransomware guidance supports offline/encrypted backups and recovery testing for destructive threats [CISA-BACKUP01]. NIST's data-integrity guidance likewise treats ransomware, destructive malware, insider threats, and honest mistakes as corruption/destruction scenarios requiring asset awareness, protection, secure storage, backups, integrity checking, and audit evidence [NIST-DI01].

## 20.4 3-2-1

“3-2-1 backup” can be a useful heuristic, not a universal law. The actual requirement is independent recoverability across the failure scenarios that matter.

---

# 21. Restore and disaster recovery standard

## 21.1 Restore acceptance criteria

A material restore is not complete until:

- [ ] data can be read and critical invariants pass;
- [ ] required schema/version matches the application path;
- [ ] credentials and encryption keys are available;
- [ ] object/file dependencies are present;
- [ ] routing/connection configuration is correct;
- [ ] critical user/system journeys pass;
- [ ] replication/resynchronization state is safe;
- [ ] achieved data-loss window is within RPO if defined;
- [ ] achieved recovery time is within RTO if defined;
- [ ] operators can execute the runbook without hidden author knowledge;
- [ ] restored system is not accidentally connected to destructive production writers during rehearsal.

AWS explicitly recommends periodic recovery testing and validation against RPO/RTO rather than assuming backups are usable [AWS-BACKUP01].

## 21.2 Point-in-time recovery

PITR requires:

- a consistent base;
- continuous/adequate change log history;
- retained logs covering the target point;
- timeline/branch awareness where supported;
- verified restore procedure;
- application-level validation.

A database PITR may restore the database to 12:00 while an external object store, message queue, payment provider, or search index remains at 12:15. Cross-system recovery consistency must be designed separately.

## 21.3 Restore frequency

There is no universal monthly/quarterly number. Increase drill frequency with:

- criticality;
- change rate;
- backup-system volatility;
- operator turnover;
- failed drills;
- RTO strictness;
- regulatory/contractual need.

---

# 22. Corruption, reconciliation, and repair

## 22.1 Corruption response

```text
DETECT
→ CONTAIN WRITES IF NECESSARY
→ PRESERVE EVIDENCE
→ IDENTIFY AUTHORITY / LAST KNOWN GOOD
→ MEASURE BLAST RADIUS
→ CHOOSE RESTORE vs REPAIR vs REPLAY
→ EXECUTE BOUNDED CHANGE
→ RECONCILE
→ VERIFY USER/SYSTEM INVARIANTS
→ REOPEN TRAFFIC
→ LEARN
```

Do not default to “fix the row” before understanding whether the same defect affected thousands of rows.

## 22.2 Repair tool standard

A repair must include:

```yaml
incident_or_change_id:
authoritative_truth:
scope_query:
expected_count_or_bound:
dry_run_output:
mutation:
idempotency:
transaction_or_batching:
stop_conditions:
backup_or_reversal:
audit_log:
reconciliation_query:
postconditions:
owner:
reviewer:
```

For C3/C4 data, require independent review or pair execution as governed by the applicable assurance model.

## 22.3 Silent/latent corruption

Corruption is not limited to application bugs or attackers. Large systems can experience hardware/firmware/path failures that return plausible but incorrect bytes; Google's exabyte-scale Spanner experience documents recurring silent-data-corruption detection and the need for layered detection/prevention [SDC01].

For data whose silent corruption would be material, decide explicitly whether the stack provides and verifies:

- page/block/object checksums or authenticated integrity;
- end-to-end checksum preservation across copies/transfers;
- periodic scrubbing/read verification;
- replica disagreement detection;
- checksum/error telemetry and quarantine;
- independent reconstruction or comparison source;
- tested repair/rebuild path.

Do not cargo-cult all mechanisms into low-risk systems; scale them with criticality and actual platform semantics.

## 22.4 Recovery truth and last-known-good state

After corruption or ransomware, “newest available backup” is not automatically the correct recovery point. Recovery SHOULD reconstruct the corruption timeline, identify the last state known or sufficiently evidenced to be good, restore into isolation when practical, validate integrity/application invariants, and only then promote recovered state. NIST's recovery/detection practice guides explicitly frame recovery as restoring trustworthy data after destructive events rather than merely making bytes available [NIST-REC01][NIST-DETECT01].

---

# 23. Schema migration standard

## 23.1 Migration classes

Classify each change:

### M0 — Metadata/low-risk
Examples: compatible metadata/comment changes.

### M1 — Additive compatible
Examples: nullable column, new table/index where build behavior is safe.

### M2 — Backfill / constraint activation
Examples: populate new field, validate existing data, enable stronger constraint.

### M3 — Rewrite / heavy DDL
Examples: type rewrite, large index build, partition transformation.

### M4 — Destructive / semantic
Examples: drop/rename without compatibility, delete/rewrite source of truth, change identifier/tenant/shard semantics.

Risk class is contextual; the same SQL syntax can have different operational behavior by engine/version/table size.

## 23.2 Migration plan

```yaml
migration_id:
goal:
engine_and_version:
risk_class:
schema_before:
schema_after:
compatible_app_versions:
ddl_semantics:
lock_expectation:
rewrite_scan_expectation:
io_wal_log_expectation:
backfill:
reconciliation:
stop_conditions:
rollback_or_rollforward:
backup_recovery:
observability:
owner:
reviewers:
```

## 23.3 Expand / migrate / contract

The default live-system pattern is:

```text
A. EXPAND
   Add new compatible representation.

B. MAKE CODE COMPATIBLE
   New code can tolerate old + new state.

C. MIGRATE / BACKFILL
   Bounded, resumable, observable.

D. RECONCILE
   Compare old/new authority.

E. SWITCH
   Move reads/writes intentionally.

F. PROVE OLD PATH QUIET
   Telemetry + version retirement.

G. CONTRACT
   Remove obsolete representation later.
```

## 23.4 Backfill standard

A material backfill MUST define:

- deterministic population;
- stable cursor/key/range;
- retry/restart checkpoint;
- batch size;
- rate limit;
- concurrency;
- transaction size;
- error quarantine;
- progress metric;
- replication/load guardrails;
- reconciliation;
- completion proof.

Avoid `OFFSET`-based scanning for very large changing datasets when it produces unstable/expensive progress; use an engine/workload-appropriate stable cursor/key strategy.

## 23.5 Mixed-version compatibility is a correctness property

Online schema changes normally create a period in which old and new application/schema versions coexist. Google's F1 work demonstrates that common schema changes can create anomalies or corruption when different servers write shared data under incompatible schema versions [MIG01].

For material online evolution, define a compatibility matrix:

| Writer/reader | Old schema/state | Transitional state | New schema/state |
|---|---|---|---|
| old application | supported? | supported? | supported? |
| new application | supported? | supported? | supported? |
| background jobs | supported? | supported? | supported? |
| rollback version | supported? | supported? | supported? |

A migration phase MUST NOT advance until every still-live writer/reader is compatible with that phase or has been removed from service.

## 23.6 Fleet migration control

Database-per-tenant, sharded, regional, and other fleet architectures require migration orchestration as an engineering subsystem. Google's multi-year transparent Datastore-to-Firestore migration of more than one million databases is strong operational evidence that safe large fleets need staged automation, compatibility, observability, retry/recovery, and explicit convergence rather than ad-hoc loops [MIG02].

Minimum fleet state:

```yaml
target_version:
cohort:
current_version_by_unit:
in_progress:
failed_or_quarantined:
retry_policy:
compatibility_window:
health_guardrails:
reconciliation:
completion_criterion:
rollback_or_rollforward:
```

---

# 24. Multi-tenancy standard

## 24.1 The seven isolation planes

A tenant architecture is incomplete until these planes are considered:

1. **identity plane** — how principal → tenant membership is established;
2. **authorization plane** — which resource/action within tenant scope is permitted;
3. **data plane** — how rows/documents/databases/buckets are separated;
4. **resource plane** — compute, connection, I/O, storage, queue, rate, and quota fairness;
5. **operations/control plane** — migrations, admin jobs, observability, support, credentials, routing;
6. **recovery plane** — backup/restore/export/DR granularity and blast radius;
7. **lifecycle plane** — onboarding, move, region/tier change, retention, offboarding, deletion.

Microsoft's multitenant architecture guidance explicitly treats isolation as a spectrum and highlights scale, noisy-neighbor behavior, tenant-specific recovery, encryption keys, geography, migration, and lifecycle trade-offs [AZ-TEN01].

## 24.2 Topology options

### Pooled shared schema/tables

Advantages:

- high density/cost efficiency;
- simpler fleet count;
- uniform migrations.

Risks:

- cross-tenant query mistakes;
- noisy neighbors;
- selective restore complexity;
- shared blast radius.

### Schema-per-tenant

Advantages:

- stronger namespace separation;
- some migration/customization flexibility.

Risks:

- large schema fleets;
- connection/catalog overhead;
- per-schema drift;
- still shared database privileges/resources.

### Database-per-tenant

Advantages:

- stronger data/recovery isolation;
- tenant-level backup/move/version choices.

Risks:

- fleet orchestration;
- connection/resource overhead;
- schema/version drift;
- backup/monitoring cost.

### Dedicated cluster/account/resource

Advantages:

- strongest infrastructure separation for demanding tenants.

Risks:

- highest cost and operational complexity;
- fleet upgrades and observability become major systems.

### Hybrid

Use pools by default and dedicated placement where risk, scale, geography, contractual isolation, or noisy-neighbor requirements justify it.

## 24.3 Pooled-schema rules

For pooled relational models:

```text
tenant_id should be present in every tenant-owned row unless scope is inherited through a structure that is independently enforced and proven safe.
```

Prefer:

- composite uniqueness including tenant;
- tenant-aware foreign keys where appropriate;
- tenant predicates derived from trusted server context;
- RLS/structural policy as defense in depth;
- tenant-aware indexes;
- negative cross-tenant tests.

Do not accept:

```sql
WHERE tenant_id = request.body.tenant_id
```

as the sole authorization model.

## 24.4 PostgreSQL RLS example

PostgreSQL 18 row security can restrict visible/modifiable rows and defaults to deny if RLS is enabled but no policy applies; however, superusers, `BYPASSRLS` roles, and normally table owners can bypass policies unless configured otherwise [PG-RLS01].

Therefore:

- RLS is strong defense in depth;
- privileged roles require separate governance;
- background/migration/admin paths require tests;
- schema ownership and connection roles matter.

## 24.5 Tenant lifecycle

Every tenant topology must support:

```text
CREATE
→ ASSIGN PLACEMENT
→ INITIALIZE DATA
→ OPERATE
→ OBSERVE USAGE / HEALTH
→ MOVE / SCALE / CHANGE REGION OR TIER
→ EXPORT IF REQUIRED
→ OFFBOARD
→ DELETE / RETAIN PER POLICY
→ EXPIRE BACKUP/DERIVED COPIES PER POLICY
```

A topology that cannot safely move or remove a tenant is incomplete.

---

# 25. Tenant isolation verification

Test at least:

1. tenant A cannot read tenant B by normal ID substitution;
2. tenant A cannot mutate tenant B;
3. bulk/list/search endpoints preserve tenant scope;
4. background jobs preserve tenant scope;
5. cached/search/vector keys preserve tenant scope;
6. privileged support access is explicit/audited;
7. migration jobs cannot omit tenant scope;
8. exports cannot cross tenant scope;
9. restore/selective recovery preserves tenant identity;
10. soft-delete/archive paths preserve isolation;
11. analytics/warehouse exports preserve allowed scope;
12. object-storage paths/presigned links preserve scope;
13. per-tenant quotas/noisy-neighbor controls work under overload;
14. tenant move does not expose duplicate/partial routing;
15. offboarding removes or retains each data copy according to policy.

---

# 26. Retention, archival, and deletion

## 26.1 Data lifecycle states

Model at least where relevant:

```text
ACTIVE
→ INACTIVE
→ ARCHIVED
→ RETENTION_HOLD (optional)
→ DELETION_ELIGIBLE
→ DELETED_FROM_PRIMARY
→ EXPIRED_FROM_DERIVED STORES
→ EXPIRED_FROM BACKUPS / RECOVERY HISTORY
```

Actual legal/privacy retention requirements must come from the applicable authority, not this playbook.

## 26.2 Soft delete decision

Use soft delete when:

- product undo/recovery needs it;
- audit/history needs it;
- workflows depend on reversible deactivation.

Avoid or constrain it when:

- true deletion is required;
- hidden rows make uniqueness/queries error-prone;
- retained sensitive data has no justified purpose;
- “soft delete forever” becomes accidental retention.

If used, define:

- filtering policy;
- uniqueness behavior;
- FK behavior;
- restoration;
- final purge;
- backup behavior.

---

# 27. Security and privacy interface

This playbook does not replace the Security or Privacy playbooks.

Data/storage designs MUST hand off at least:

```yaml
classification:
sensitive_fields:
authorization_model:
tenant_isolation:
encryption_at_rest:
encryption_in_transit:
key_management:
privileged_access:
audit_events:
retention:
deletion:
backup_security:
restore_privileges:
data_residency:
development_test_data_policy:
```

Security controls must survive backup, export, replica, search, analytics, and repair paths—not only the primary database API.
# 28. Data observability and operational health

Observability exists to answer operational questions, not to maximize telemetry volume.

## 28.1 Core operational questions

Operators should be able to answer, where relevant:

- Are critical reads/writes succeeding?
- Are transactions aborting or retrying unusually?
- Which queries/tenants are consuming the capacity?
- Are lock waits/deadlocks rising?
- Is replication lag outside the accepted freshness contract?
- Is backup age within policy?
- When was the last successful restore test?
- Is a migration/backfill progressing safely?
- Are derived stores within freshness/reconciliation tolerance?
- Is data growth approaching capacity or cost thresholds?
- Are data-quality dimensions degrading?
- Are tenant-isolation or privileged-access events occurring?
- Are checksums/corruption signals present?

## 28.2 Suggested signals

| Area | Useful signals |
|---|---|
| transactions | commit/abort/retry/serialization-failure rate |
| concurrency | lock wait, deadlock, conflict rate |
| query | latency percentiles, rows scanned/returned, plan changes |
| storage | size/growth, IOPS/throughput, cache/buffer pressure, compaction/vacuum |
| replication | lag, replica health, failover state |
| backup | latest recovery point, job status, backup age |
| restore | last drill date, achieved RPO/RTO, validation failures |
| migration | rows/objects completed, rate, errors, remaining, system impact |
| derived | freshness lag, rebuild age, reconciliation mismatch |
| tenancy | per-tenant consumption, error/latency, quota/throttle events |
| quality | invalid/missing/duplicate/stale rate as domain-defined |
| corruption | checksum/integrity/reconciliation failures |

Do not page humans on a metric unless there is a meaningful action.

---

# 29. Verification and validation standard

## 29.1 Verification portfolio

Select methods from failure modes.

| Risk | Strong evidence candidates |
|---|---|
| field/domain constraint | schema/unit/property tests |
| uniqueness race | parallel integration test |
| referential integrity | constraint + deletion/update tests |
| write skew | controlled concurrent transaction test |
| retry/idempotency | duplicate/replay/fault injection |
| cross-system divergence | outbox/saga/reconciliation failure tests |
| replica staleness | failover/lag/read-routing test |
| shard movement | shadow read/reconciliation + routing cutover test |
| migration | representative-volume rehearsal + compatibility matrix |
| backup | isolated restore + application validation |
| corruption repair | dry-run + bounded mutation + reconciliation |
| tenant isolation | negative cross-tenant tests across all access paths |
| noisy neighbor | tenant-skew load test |
| format evolution | old/new reader-writer compatibility |
| vector/search freshness | source-version/rebuild/reconciliation tests |

## 29.2 Criticality scaling

### C0/C1
- deterministic schema/model tests;
- basic backup/recovery if state has value;
- smoke migration.

### C2
- concurrency and failure tests;
- representative migration rehearsal;
- restore test;
- tenant-isolation negative tests if multitenant;
- data-quality/observability.

### C3
- independent review of material invariants;
- stronger failure injection;
- scheduled restore drills;
- repair rehearsal;
- migration rollback/roll-forward rehearsal;
- cross-system reconciliation evidence;
- privileged tenant isolation tests.

### C4
- applicable domain-certified assurance;
- independent V&V/formal methods where required;
- stronger evidence retention and change control.

## 29.3 Property-based/model testing

Property-based testing is useful when invariants can be stated across broad generated input/state spaces. Model checking/formal methods can be useful for high-consequence state machines or distributed coordination where the modeled state space is tractable.

Neither proves the business requirement itself is correct; validation remains separate.

---

# 30. Production readiness gate — data and storage

A system storing material data is not production-ready until applicable items pass.

## Modeling and integrity

- [ ] authoritative facts and owners defined;
- [ ] material invariants identified;
- [ ] invalid states structurally constrained where practical;
- [ ] identity/key semantics defined;
- [ ] time/numeric/null semantics defined where material.

## Transactions and concurrency

- [ ] transaction boundaries correspond to invariants;
- [ ] isolation/concurrency behavior justified;
- [ ] retries/idempotency/deduplication defined;
- [ ] external side effects have a divergence/reconciliation strategy;
- [ ] concurrent tests cover material races.

## Distributed state

- [ ] consistency/read freshness is explicit;
- [ ] replication/failover behavior is known;
- [ ] partition/conflict behavior is explicit;
- [ ] shard/partition placement is justified if used.

## Storage/performance

- [ ] storage family fits workload and team capability;
- [ ] critical query plans/load behavior tested;
- [ ] indexes have known purpose/cost;
- [ ] capacity and growth assumptions are recorded.

## Recovery

- [ ] RPO/RTO defined where material;
- [ ] backup/recovery failure scenarios mapped;
- [ ] recovery copies protected against relevant correlated failures;
- [ ] restore runbook tested;
- [ ] restored application/data validated;
- [ ] keys/config/dependencies are recoverable.

## Migration

- [ ] schema deployment order compatible;
- [ ] material migration rehearsed;
- [ ] backfill resumable/bounded/observable;
- [ ] stop criteria defined;
- [ ] rollback/roll-forward state compatibility understood.

## Multi-tenancy

- [ ] topology matches isolation/recovery/cost needs;
- [ ] tenant identity comes from trusted context;
- [ ] data and privileged paths are isolated;
- [ ] noisy-neighbor controls tested where needed;
- [ ] tenant restore/export/delete path exists.

## Operations

- [ ] data-health telemetry and actionable alerts;
- [ ] repair/reconciliation tools controlled;
- [ ] owner/on-call/escalation defined where needed;
- [ ] retention/deletion lifecycle defined.

---

# 31. Data architecture decision framework

For a disputed data decision, execute this sequence.

## Step 1 — State the invariant/outcome

What must remain true?

## Step 2 — State failure consequence

What happens if data is wrong, missing, stale, duplicated, leaked, or unavailable?

## Step 3 — State authority

Who/what may write? Which copy wins if copies differ?

## Step 4 — State access/workload

- key lookups;
- range scans;
- joins;
- graph traversal;
- full text;
- vector similarity;
- analytical scans;
- write pattern;
- concurrency;
- data volume;
- retention.

## Step 5 — State transaction/consistency requirement

Which operations must be atomic or ordered? What staleness is acceptable?

## Step 6 — State recovery requirement

RPO/RTO, failure scenarios, tenant granularity.

## Step 7 — Compare the least-complex viable options

Compare:

```yaml
correctness:
integrity:
transaction_semantics:
consistency:
availability:
latency:
capacity:
migration:
recovery:
tenant_isolation:
operability:
team_skill:
portability:
cost:
irreversibility:
```

## Step 8 — Prototype only the highest-value uncertainty

Examples:

- contention benchmark;
- failover behavior;
- query plan at representative scale;
- migration lock/rewrite;
- selective tenant restore;
- resharding test.

## Step 9 — Record decision and revisit trigger

Do not create an ADR for trivial index names. Do record consequential storage/consistency/tenancy decisions.

---

# 32. Core decision trees

## 32.1 Relational vs specialized store

```text
Do material invariants benefit from transactions/constraints/joins?
  ├─ YES → Can a relational design meet scale/latency/operability?
  │          ├─ YES → default toward relational simplicity
  │          └─ NO  → identify the exact specialized constraint
  └─ NO  → Is access naturally key/document/graph/search/vector/analytical?
             ├─ YES → evaluate specialized store
             └─ NO  → prefer the store the team can operate with least total complexity
```

## 32.2 Need serializable transactions?

```text
Can the invariant be guaranteed with a unique/check/FK/atomic conditional operation?
  ├─ YES → prefer the simpler direct control
  └─ NO  → Can weaker isolation + explicit locks/version checks be proven safe?
             ├─ YES → use and test it
             └─ NO  → use serializable/stronger coordination and handle retries
```

## 32.3 Add a cache?

```text
Is measured source latency/load a material problem?
  ├─ NO → don't cache yet
  └─ YES → Can source/index/query design solve it more simply?
             ├─ YES → improve source
             └─ NO → Can staleness + invalidation + tenant scope be explicit?
                        ├─ NO → do not add correctness-critical cache
                        └─ YES → add measured cache
```

## 32.4 Add a search/vector read model?

```text
Does specialized retrieval materially improve a user/system outcome?
  ├─ NO → keep one source
  └─ YES → Can it remain derived and rebuildable from authority?
             ├─ YES → define freshness/rebuild/reconciliation
             └─ NO  → treat it as a new authority and redesign transaction/lifecycle semantics
```

## 32.5 Partition/shard?

```text
Is there a demonstrated capacity/isolation/geography/lifecycle need?
  ├─ NO → do not distribute state yet
  └─ YES → Can in-database partitioning solve it?
             ├─ YES → prefer simpler boundary
             └─ NO  → shard with explicit key, routing, cross-shard and resharding semantics
```

## 32.6 Pooled vs dedicated tenant storage

```text
Do tenants require strong physical/recovery/key/geography isolation?
  ├─ YES → dedicated DB/resource may be justified
  └─ NO  → Can pooled storage meet security + noisy-neighbor + recovery needs?
             ├─ YES → pooled/shared is simpler and denser
             └─ NO  → hybrid or dedicated placement
```

## 32.7 Restore vs repair

```text
Is a trustworthy recovery point available within acceptable RPO/RTO?
  ├─ YES → Would restore overwrite large amounts of known-good newer state?
  │          ├─ NO → restore may be safest
  │          └─ YES → consider selective restore + reconciliation/repair
  └─ NO  → Is authoritative truth reconstructable from logs/external systems?
             ├─ YES → controlled rebuild/repair
             └─ NO  → contain, preserve evidence, escalate residual-loss decision
```

## 32.8 Soft delete?

```text
Is reversible product/audit retention actually required?
  ├─ NO → prefer real lifecycle deletion/archival
  └─ YES → Can uniqueness, query filtering, final purge and privacy semantics be made explicit?
             ├─ YES → soft delete may fit
             └─ NO  → redesign lifecycle
```

## 32.9 Two-phase commit vs saga

```text
Must all participating resources present one atomic outcome?
  ├─ YES → Can all resources participate in a supported atomic commit protocol?
  │          ├─ YES → evaluate 2PC/consensus cost and failure behavior
  │          └─ NO  → architecture cannot honestly promise atomic cross-resource commit
  └─ NO  → Can intermediate states + compensations be made safe and observable?
             ├─ YES → saga/workflow
             └─ NO  → redesign boundary or centralize invariant
```

---

# 33. Architecture review standard

## Context
- [ ] domain facts/invariants explicit
- [ ] authoritative sources defined
- [ ] criticality assigned
- [ ] data classification and tenant scope known

## Model
- [ ] identity and keys justified
- [ ] normalization/duplication semantics clear
- [ ] time/null/numeric semantics clear
- [ ] history/lifecycle modeled

## Transactions
- [ ] transaction boundaries align with invariants
- [ ] isolation/anomalies understood
- [ ] external side effects not falsely included
- [ ] retries/idempotency safe

## Distribution
- [ ] consistency named
- [ ] replication/failover semantics clear
- [ ] partition behavior explicit
- [ ] shard key and resharding justified

## Storage
- [ ] store family selected from requirements
- [ ] indexes/access paths based on workload
- [ ] physical maintenance/compaction understood
- [ ] specialized derived stores rebuildable/reconciled

## Recovery
- [ ] RPO/RTO
- [ ] backup failure-domain independence
- [ ] restore evidence
- [ ] corruption/repair path

## Tenancy
- [ ] isolation planes reviewed
- [ ] privileged paths
- [ ] resource/noisy-neighbor
- [ ] tenant recovery/lifecycle

## Evolution
- [ ] compatible migration path
- [ ] fleet/schema versioning
- [ ] rollback/roll-forward state compatibility
- [ ] retirement/deletion

---

# 34. Schema review standard

For every material schema change:

- [ ] domain meaning clear;
- [ ] source of truth unchanged or deliberately changed;
- [ ] constraints reflect intended invariants;
- [ ] nullable/default semantics correct;
- [ ] key/uniqueness/tenant scope correct;
- [ ] FK/cascade lifecycle correct;
- [ ] indexes support required access and have acceptable write cost;
- [ ] engine/version DDL behavior checked;
- [ ] old/new application versions compatible;
- [ ] backfill/reconciliation defined;
- [ ] retention/deletion implications checked;
- [ ] rollback/roll-forward understood.

---

# 35. Transaction/concurrency review standard

- [ ] invariant stated;
- [ ] transaction read/write/predicate set understood;
- [ ] chosen isolation documented;
- [ ] lost-update risk considered;
- [ ] write-skew/predicate race considered;
- [ ] lock/version strategy clear;
- [ ] deadlock/abort/retry path clear;
- [ ] external side effects isolated or reconciled;
- [ ] idempotency/deduplication tested;
- [ ] concurrent integration test proves the invariant.

---

# 36. Backup and restore readiness standard

- [ ] recovery scenarios defined;
- [ ] RPO/RTO defined where material;
- [ ] backup method and retention cover scenarios;
- [ ] copies isolated from relevant destructive failures;
- [ ] encryption keys/credentials/config recoverable;
- [ ] point-in-time history adequate if required;
- [ ] restore runbook exists;
- [ ] isolated restore performed;
- [ ] integrity/domain checks pass;
- [ ] application compatibility verified;
- [ ] achieved RPO/RTO measured;
- [ ] operator can execute without author coaching;
- [ ] next drill trigger/cadence defined.

---

# 37. Migration release standard

Before production migration:

- [ ] migration ID/version fixed;
- [ ] engine/version confirmed;
- [ ] risk class assigned;
- [ ] DDL lock/rewrite/I/O behavior understood;
- [ ] representative-scale rehearsal completed if material;
- [ ] compatible deploy order defined;
- [ ] backup/recovery path verified;
- [ ] backfill checkpoint/resume works;
- [ ] batch/rate/concurrency bounded;
- [ ] stop criteria explicit;
- [ ] metrics/dashboard ready;
- [ ] old/new reconciliation query prepared;
- [ ] roll-forward/rollback decision rule explicit;
- [ ] owner available;
- [ ] post-migration verification defined;
- [ ] old schema removal intentionally delayed until usage evidence exists.

---

# 38. Multi-tenancy review standard

- [ ] tenant definition and membership source explicit;
- [ ] topology chosen from isolation/cost/scale/recovery requirements;
- [ ] tenant identity derived from trusted context;
- [ ] pooled tables structurally scoped;
- [ ] uniqueness/FK/indexes tenant-aware;
- [ ] RLS/policy behavior tested if used;
- [ ] privileged bypass paths enumerated;
- [ ] support/admin access audited;
- [ ] background jobs tenant-safe;
- [ ] cache/search/vector/object keys tenant-safe;
- [ ] noisy-neighbor controls tested;
- [ ] per-tenant observability adequate;
- [ ] tenant restore/export/delete defined;
- [ ] region/key requirements supported;
- [ ] tenant movement tested;
- [ ] offboarding covers all copies.

---

# 39. Operational Plays

## PLAY-DATA-001 — Define a new authoritative data model

### Objective
Produce a model whose identity, invariants, lifecycle, transaction requirements, and recovery expectations are explicit before technology-specific optimization.

### Use when
A new material domain entity/state is introduced.

### Method
1. identify facts and domain owner;
2. define identity and tenant scope;
3. state invariants;
4. define lifecycle/history;
5. define expected writers/readers;
6. define transaction/consistency needs;
7. select storage family;
8. map constraints/indexes;
9. define recovery and retention;
10. verify with representative scenarios.

### Acceptance
- no material invariant exists only as prose;
- authority is unambiguous;
- storage choice has a requirement-based rationale.

## PLAY-DATA-002 — Select transaction and isolation semantics

### Objective
Prevent concurrency histories that violate business invariants without unnecessary coordination.

### Method
1. state invariant;
2. enumerate concurrent operations;
3. identify anomaly histories;
4. test direct constraint/atomic operation;
5. evaluate optimistic/pessimistic/serializable mechanisms;
6. define retry/idempotency;
7. implement concurrent test;
8. monitor abort/conflict behavior in production.

### Acceptance
The invariant survives the tested concurrent cases and the failure/retry path is safe.

## PLAY-DATA-003 — Execute a live schema migration

### Objective
Change live state/schema without uncontrolled incompatibility or blast radius.

### Method
Use the Migration Release Standard and expand/migrate/contract sequence.

### Acceptance
- data reconciled;
- old/new code compatibility proven for rollout window;
- no unexplained migration errors;
- old path removed only after usage evidence.

## PLAY-DATA-004 — Restore from backup

### Objective
Restore service/data to a verified acceptable state within defined objectives.

### Method
1. declare target recovery point;
2. isolate restore environment;
3. restore required data/config/keys;
4. validate integrity;
5. validate application;
6. measure RPO/RTO;
7. only then authorize production cutover.

### Acceptance
Recovery objectives and critical invariants are demonstrated.

## PLAY-DATA-005 — Repair corrupted data

### Objective
Repair the smallest justified scope while preserving auditability and avoiding secondary corruption.

### Method
Use controlled repair standard in §22.

### Acceptance
- scope reconciled to authority;
- postconditions pass;
- before/after evidence retained at required rigor;
- follow-up prevents recurrence where possible.

## PLAY-DATA-006 — Move a tenant

### Objective
Move tenant data between pool/shard/database/region without data loss, leakage, or split routing.

### Method
1. create target placement;
2. establish snapshot/base copy;
3. capture incremental changes;
4. reconcile;
5. quiesce or establish safe cutover protocol;
6. switch durable routing authority;
7. verify read/write and isolation;
8. retain rollback/recovery window;
9. retire old copy deliberately.

### Acceptance
One authoritative placement exists, routing is unambiguous, and source/target reconciliation passes.

## PLAY-DATA-007 — Rebuild a derived store

### Objective
Restore cache/search/vector/analytical projection from authoritative state.

### Method
1. freeze/identify derivation version;
2. create new generation;
3. backfill from source;
4. replay incremental changes;
5. reconcile/freshness check;
6. switch readers;
7. retire old generation later.

### Acceptance
Source-version coverage and freshness are proven; no direct ad-hoc fixes remain as hidden truth.

---

# 40. Runbook skeletons

## RUN-DATA-RESTORE

```markdown
Trigger:
Recovery point:
Affected systems:
Authoritative incident/change ID:
Required credentials/keys:
Restore source:
Isolation safeguards:
Steps:
Validation queries:
Application smoke checks:
RPO result:
RTO result:
Cutover authority:
Failure/escalation:
Evidence retained:
```

## RUN-DATA-MIGRATE

```markdown
Migration version:
Engine/version:
Preconditions:
Compatible application versions:
Lock/rewrite expectation:
Backfill command/job:
Rate/batch bounds:
Stop thresholds:
Monitoring:
Reconciliation:
Roll-forward:
Rollback limitations:
Owner:
```

## RUN-DATA-REPAIR

```markdown
Incident:
Authority:
Scope bound:
Dry-run:
Backup/evidence:
Mutation:
Idempotency:
Batch/transaction:
Stop threshold:
Reconcile:
Postconditions:
Reviewer:
Approver:
```

---

# 41. Templates

## 41.1 Invariant register

```markdown
| ID | Invariant | Authority | Writers | Failure consequence | Enforcement | Concurrency dependency | Reconciliation | Test |
|---|---|---|---|---|---|---|---|---|
```

## 41.2 Data ownership register

```markdown
| Data/fact | Source of truth | Owner | Writers | Readers | Consistency | Retention | Backup/recovery | Derived copies |
|---|---|---|---|---|---|---|---|---|
```

## 41.3 Transaction record

```yaml
transaction:
invariant:
store:
isolation:
reads:
writes:
locks_or_versions:
external_side_effects:
retry:
idempotency:
timeout:
observability:
```

## 41.4 Migration record

```yaml
migration_id:
schema_version_from:
schema_version_to:
engine_version:
risk_class:
compatible_app_versions:
ddl:
backfill:
reconciliation:
stop_conditions:
recovery:
rollback_or_rollforward:
started:
completed:
result:
```

## 41.5 Tenant data contract

```yaml
tenant_definition:
identity_source:
topology:
data_scope:
authorization:
privileged_access:
resource_isolation:
backup_restore:
export:
offboarding:
retention_delete:
region:
encryption_keys:
observability:
```

## 41.6 Derived-store contract

```yaml
store:
purpose:
source:
derivation:
source_version_field:
freshness:
update_order:
duplicates:
rebuild:
reconciliation:
delete_propagation:
tenant_scope:
```

---

# 42. Metrics and guardrails

Measure only signals that support decisions.

## Integrity
- invariant violation rate;
- reconciliation mismatch;
- duplicate identity rate;
- orphan-reference rate where externally managed.

## Transactions
- abort/retry rate;
- deadlock rate;
- serialization failure rate;
- idempotency duplicate suppression.

## Performance
- p50/p95/p99 query latency;
- throughput;
- lock wait;
- I/O/CPU/memory/saturation;
- plan regressions.

## Replication
- lag/freshness;
- failover events;
- replica divergence/conflict.

## Recovery
- latest recoverable point;
- backup age;
- restore drill success;
- achieved RPO/RTO;
- last successful application-valid restore.

## Migration
- rows/items completed;
- rate;
- errors/quarantine;
- remaining;
- replication/load impact;
- reconciliation mismatch.

## Tenancy
- per-tenant latency/error;
- resource consumption;
- quota/throttle events;
- cross-tenant access violations;
- placement/move status.

## Data quality
- accuracy/completeness/currentness/uniqueness measures only where decision-use is defined.

Never use “number of tables,” “number of indexes,” or “database uptime” alone as a quality proxy.

---

# 43. Anti-playbook — claims to resist

## 43.1 “ACID means our data is correct.”
**Verdict:** false assurance.  
**Better:** state transaction scope, isolation, durability assumption, invariant, and external side effects.

## 43.2 “Serializable is always best.”
**Verdict:** contextual.  
**Better:** use the strongest necessary semantics with evidence; direct constraints or atomic operations may be simpler.

## 43.3 “Read Committed is good enough for web apps.”
**Verdict:** unsupported generalization.  
**Better:** map concurrency histories to invariants.

## 43.4 “CAP means pick two.”
**Verdict:** misleading.  
**Better:** specify behavior during partitions and consistency/latency trade-offs outside partitions.

## 43.5 “Eventually consistent means eventually correct.”
**Verdict:** false.  
**Better:** convergence rules must preserve the domain invariant.

## 43.6 “Last write wins resolves conflicts.”
**Verdict:** implementation rule, not correctness proof.  
**Better:** accept only if losing one value is valid.

## 43.7 “Timestamps show which event happened first.”
**Verdict:** false in distributed causal reasoning.  
**Better:** use scoped ordering guarantees/logical causality when order matters.

## 43.8 “UUIDs prevent identity problems.”
**Verdict:** false.  
**Better:** UUIDs address identifier generation; domain identity/duplicates remain separate.

## 43.9 “UUIDv7 gives event order.”
**Verdict:** false.  
**Better:** time ordering is not causal or commit ordering.

## 43.10 “Natural keys are best.”
**Verdict:** contextual.  
**Better:** choose based on stability, semantics, privacy, and interoperability.

## 43.11 “Surrogate keys solve uniqueness.”
**Verdict:** false.  
**Better:** retain domain unique constraints.

## 43.12 “NoSQL is more scalable.”
**Verdict:** overgeneralization.  
**Better:** compare actual architecture/workload.

## 43.13 “SQL does not scale.”
**Verdict:** false generalization.  
**Better:** identify the capacity/coordination bottleneck.

## 43.14 “Schema-less databases need no schema governance.”
**Verdict:** false.  
**Better:** logical schemas and lifecycle still exist.

## 43.15 “Put flexible fields in JSON.”
**Verdict:** contextual.  
**Better:** use JSON when flexibility outweighs constraint/query/evolution costs.

## 43.16 “Normalize everything.”
**Verdict:** dogma.  
**Better:** normalize authoritative facts; denormalize deliberately for measured access needs.

## 43.17 “Denormalization is faster.”
**Verdict:** incomplete.  
**Better:** measure end-to-end read/write/reconciliation cost.

## 43.18 “Foreign keys are too slow at scale.”
**Verdict:** contextual implementation claim.  
**Better:** remove only when evidence justifies and replacement integrity controls exist.

## 43.19 “Application validation is enough.”
**Verdict:** unsafe under concurrent/multiple writers.  
**Better:** enforce authoritative invariants at authoritative boundary.

## 43.20 “One service owns the table, so races are impossible.”
**Verdict:** false.  
**Better:** multiple concurrent requests/workers still race.

## 43.21 “Retries improve reliability.”
**Verdict:** only when safe/bounded.  
**Better:** retry transient aborts with idempotency and limits.

## 43.22 “Exactly once solves duplicates.”
**Verdict:** misleading outside tightly scoped guarantees.  
**Better:** make business effects idempotent/deduplicated.

## 43.23 “A saga rolls back a distributed transaction.”
**Verdict:** false.  
**Better:** sagas compensate; intermediate effects may have been observed.

## 43.24 “2PC makes distribution easy.”
**Verdict:** false.  
**Better:** it buys atomic commit under defined assumptions while adding coordination/failure complexity.

## 43.25 “Replication is backup.”
**Verdict:** false.  
**Better:** design independent recovery from logical/destructive failure.

## 43.26 “Managed backup means recovery is solved.”
**Verdict:** false.  
**Better:** prove restore including keys/config/application.

## 43.27 “Backup succeeded.”
**Verdict:** weak evidence.  
**Better:** test restore and validate data/application/RPO/RTO.

## 43.28 “A replica can be promoted, so DR is solved.”
**Verdict:** incomplete.  
**Better:** test failover, data loss, split brain, dependencies, and failback.

## 43.29 “We can always roll back a migration.”
**Verdict:** false.  
**Better:** state compatibility determines rollback safety.

## 43.30 “Additive migrations are safe.”
**Verdict:** false as universal rule.  
**Better:** inspect engine/version lock/rewrite behavior.

## 43.31 “One giant migration transaction is safest.”
**Verdict:** false for many live workloads.  
**Better:** choose transaction/batching from lock, log, recovery, and partial-progress risk.

## 43.32 “Backfill can just rerun.”
**Verdict:** false unless idempotent/checkpointed.  
**Better:** design restart semantics.

## 43.33 “Dual-write both columns until migration is done.”
**Verdict:** risky.  
**Better:** minimize dual authority and reconcile; remove compatibility path promptly.

## 43.34 “Index everything.”
**Verdict:** false.  
**Better:** every index needs a query/constraint and cost justification.

## 43.35 “Indexing fixes bad queries.”
**Verdict:** incomplete.  
**Better:** inspect data shape, query plan, predicates, result size, and model.

## 43.36 “Cache makes the database scale.”
**Verdict:** contextual.  
**Better:** define staleness/invalidation and measure source first.

## 43.37 “Search is just another database.”
**Verdict:** dangerous if used as hidden authority.  
**Better:** define source/rebuild/reconciliation.

## 43.38 “Vector DB results are current.”
**Verdict:** false by default.  
**Better:** version source/chunk/model and freshness.

## 43.39 “Sharding solves scale.”
**Verdict:** incomplete.  
**Better:** it trades local limits for distributed coordination/routing/resharding complexity.

## 43.40 “Shard by tenant.”
**Verdict:** contextual.  
**Better:** test tenant size skew, access locality, and movement.

## 43.41 “Database-per-tenant is most secure.”
**Verdict:** incomplete.  
**Better:** evaluate all isolation planes.

## 43.42 “Shared database is insecure.”
**Verdict:** false generalization.  
**Better:** pooled architectures can be secure when isolation is structural and tested.

## 43.43 “RLS solves tenant isolation.”
**Verdict:** false.  
**Better:** RLS is one data-plane enforcement layer; privilege/control/recovery/resource paths remain.

## 43.44 “Tenant_id filter is isolation.”
**Verdict:** false.  
**Better:** authorization must bind trusted identity to resource scope.

## 43.45 “Soft delete is safer.”
**Verdict:** contextual.  
**Better:** design lifecycle, uniqueness, purge, and privacy semantics.

## 43.46 “Event sourcing gives perfect audit.”
**Verdict:** overbroad.  
**Better:** event correctness, schema evolution, privacy deletion, projections, and access still require design.

## 43.47 “Append-only means immutable truth.”
**Verdict:** false.  
**Better:** append-only storage can preserve history but does not establish that events were valid/correct.

## 43.48 “Data lake means keep everything.”
**Verdict:** dangerous.  
**Better:** retention, classification, ownership, quality, and cost still apply.

## 43.49 “Columnar is faster.”
**Verdict:** workload-dependent.  
**Better:** analytical scans benefit; point updates/transactions may not.

## 43.50 “B-tree is old; LSM is modern.”
**Verdict:** technology fashion.  
**Better:** choose access/update/maintenance trade-off.

## 43.51 “Encryption at rest protects the data.”
**Verdict:** partial.  
**Better:** access control, keys, application authorization, backups, exports, and logs matter.

## 43.52 “Data repair is just SQL.”
**Verdict:** unsafe.  
**Better:** repair is a controlled production mutation with evidence.

## 43.53 “We can fix bad data later.”
**Verdict:** dangerous for irreversible/external effects.  
**Better:** enforce high-consequence invariants before commit.

## 43.54 “More replicas means more durability.”
**Verdict:** only against independent failure modes.  
**Better:** analyze correlated failures and acknowledgement semantics.

## 43.55 “One database is always simpler.”
**Verdict:** overgeneralization.  
**Better:** optimize total system complexity; specialization can reduce complexity when requirements truly diverge.

---

# 44. Contradiction ledger

| Debate | Evidence-weighted conclusion |
|---|---|
| natural vs surrogate key | neither universal; preserve stable domain uniqueness regardless of PK strategy |
| normalization vs denormalization | normalize authority for integrity; denormalize deliberate derived representations when access needs justify it |
| DB constraint vs application validation | authoritative constraints prevent races; application validation improves UX and cross-system logic; often both |
| optimistic vs pessimistic locking | choose from conflict rate, latency, retry cost, and invariant |
| weaker isolation vs serializable | weaker can be correct if invariants are proven; serializable simplifies reasoning but may abort/coordinate |
| serializability vs linearizability | different guarantees; choose by transactional vs real-time visibility need |
| consistency vs availability | only meaningful under specified failure and operation semantics |
| CAP vs PACELC | CAP constrains partition behavior; normal operation still has latency/consistency choices |
| coordination vs availability | coordinate only invariants that require it; some convergent operations are coordination-free |
| local transaction vs saga | local transaction is atomic inside one resource; saga is multi-step compensation |
| 2PC vs saga | atomicity vs availability/operational flexibility; domain requirement decides |
| leader vs multi-writer | leader simplifies conflict order; multi-writer improves locality/availability but needs conflict semantics |
| B-tree vs LSM | read/update/compaction/storage trade-off, not old vs new |
| row vs column | point transaction vs analytical scan bias; mixed engines exist |
| SQL vs NoSQL | data model/guarantees/workload first; both families can scale |
| one store vs polyglot | one store reduces synchronization; specialized stores must earn lifecycle complexity |
| partition vs shard | in-engine partitioning is usually simpler; sharding creates distributed authority |
| cache vs source optimization | optimize source first when practical; cache with explicit freshness when justified |
| pooled vs dedicated tenants | pooled maximizes density; dedicated increases some isolation/recovery granularity; hybrid is common |
| RLS vs app filtering | RLS adds structural enforcement; application authorization still determines principal/resource policy |
| backup vs replica | replica supports availability; backup/history supports recovery from corruption/deletion |
| restore vs repair | restore is safer when a good recovery point exists and overwriting newer good data is acceptable; repair is selective but riskier |
| rollback vs roll-forward | choose from state compatibility; rollback is not inherently safer |
| soft delete vs hard delete | reversibility/audit vs retention/query/privacy complexity |
| schema stability vs evolution | stable contracts reduce change risk; planned compatible evolution is inevitable |
| strict schema vs flexible payload | enforce stable critical fields; isolate genuinely evolving/sparse extensions |
| time-ordered IDs vs random IDs | locality/ordering metadata vs leakage/distribution; IDs do not define causality |

---

# 45. Heuristics — useful, not laws

## 45.1 “One source of truth”
Use to prevent conflicting authority.  
Boundary: read replicas/derived stores are fine when divergence semantics are explicit.

## 45.2 “Normalize first”
Use as a relational integrity starting point.  
Boundary: measured read models/analytics/distribution can justify denormalization.

## 45.3 “Expand and contract”
Use for live compatible schema evolution.  
Boundary: not every migration needs all phases; engine-specific DDL still matters.

## 45.4 “3-2-1 backup”
Use as a failure-domain prompt.  
Boundary: the real requirement is recovery from modeled failures; copy counts/media counts are not proof.

## 45.5 “Use transactions”
Use for multi-step invariant-preserving changes.  
Boundary: a transaction cannot include resources it does not control.

## 45.6 “Use UUIDs”
Use when decentralized stable IDs help.  
Boundary: sequential/local IDs may be simpler and more efficient inside one authority.

## 45.7 “Avoid distributed transactions”
Use as a complexity warning.  
Boundary: if the invariant truly requires atomic cross-resource commit, avoiding coordination can make correctness worse.

## 45.8 “Database per service”
Use as an ownership pattern.  
Boundary: it can fragment invariants and create expensive distributed joins/transactions; boundaries must be domain-earned.

## 45.9 “Database per tenant”
Use for stronger isolation/recovery granularity.  
Boundary: operational fleet cost can dominate.

## 45.10 “Immutable events”
Use for audit/history/replay where domain events are stable.  
Boundary: event schemas, invalid events, privacy deletion, and projection evolution remain.

---

# 46. Project data/storage engineering brief

```yaml
project:
owner:
criticality: C0 | C1 | C2 | C3 | C4

domain:
  core_facts:
  critical_invariants:
  authoritative_sources:

data:
  classification:
  identity:
  tenant_scope:
  time_semantics:
  numeric_precision:
  retention:
  deletion:

workload:
  reads:
  writes:
  concurrency:
  data_volume:
  growth:
  latency:
  throughput:
  geography:

transactions:
  transaction_boundaries:
  isolation:
  idempotency:
  external_side_effects:
  reconciliation:

distributed:
  replication:
  consistency:
  staleness:
  failover:
  conflict_resolution:
  partition_behavior:

storage:
  primary_store:
  rationale:
  derived_stores:
  indexes:
  partitions_shards:

recovery:
  failure_scenarios:
  rpo:
  rto:
  backup:
  restore_test:
  repair:

migration:
  schema_strategy:
  backfill:
  compatibility:
  rollback_rollforward:

multitenancy:
  topology:
  identity_authz:
  data_isolation:
  resource_isolation:
  privileged_access:
  tenant_restore:
  tenant_move:
  offboarding:

observability:
  integrity:
  transactions:
  performance:
  replication:
  backup_restore:
  migration:
  tenant_health:

known_assumptions:
known_risks:
review_triggers:
```

---

# 47. One-page Golden Standard

If only one section can be used:

1. Model domain facts and unacceptable failure before choosing a database.
2. Give every material fact a clear authority and owner.
3. State invariants independently of schema syntax.
4. Enforce invariants at the strongest authoritative layer that can actually guarantee them.
5. Do not use application pre-checks as the sole uniqueness/integrity control under concurrent writers.
6. Define identity, nullability, exact numeric, currency, and temporal semantics explicitly.
7. Do not infer causality or commit order from wall-clock timestamps or time-ordered IDs.
8. Define transaction boundaries from business invariants.
9. A local DB transaction does not include remote side effects.
10. Design idempotency, retry, timeout, and reconciliation together.
11. Choose isolation by prohibited anomalies/invariant failures, not label familiarity.
12. Treat write skew, lost update, predicate races, and duplicate effects as first-class concurrency risks.
13. Distinguish serializability from linearizability.
14. Name distributed consistency/read-freshness guarantees.
15. Do not reduce CAP to “pick two.”
16. Coordinate the invariants that require coordination; do not coordinate everything by default.
17. Define replication lag, failover, conflict, and rejoin semantics.
18. Shard only for a demonstrated scale/isolation/geography requirement and plan resharding before you need it.
19. Choose database/storage family from semantics and workload, not fashion.
20. Treat caches/search/vector/analytics as derived stores unless deliberately authoritative.
21. Give every derived store freshness, rebuild, delete, and reconciliation semantics.
22. Design indexes from real access paths and account for write/storage/maintenance cost.
23. Replication is not backup.
24. Define RPO/RTO from consequence where loss/unavailability matters.
25. A backup is unverified until restoration proves data and application usability.
26. Include keys/config/object data/external dependencies in recovery reasoning.
27. Treat corruption repair as a controlled production write.
28. Treat migrations as programs with locks, load, partial progress, recovery, and compatibility.
29. Prefer expand/migrate/reconcile/switch/contract for live schema evolution.
30. Make backfills resumable, bounded, observable, and reconcilable.
31. Rollback is safe only when state remains compatible; otherwise roll forward deliberately.
32. Multi-tenancy is isolation across identity, authorization, data, resources, operations, recovery, and lifecycle.
33. Never trust a client-supplied tenant identifier as authorization.
34. Test tenant isolation on privileged/background/export/restore paths, not only ordinary API requests.
35. Match tenant topology to security, recovery, noisy-neighbor, geography, and cost requirements.
36. Define retention, archival, soft-delete, and final purge semantics across all copies.
37. Instrument transaction conflicts, locks, query tails, replication, backup/restore, migration, data quality, and tenant health where material.
38. Test concurrency with concurrency, restore with real restore, and migrations at representative scale.
39. Increase assurance with irreversibility, distributed ownership, low detectability, sensitive data, and blast radius.
40. Prefer the least complex **total system** that can demonstrably preserve required semantics and recover from failure.

---

# 48. V1 → V2 falsification record

V1 was not promoted unchanged. The first audit found 36 findings. A second full research/sanity pass then re-audited every V1 section and added 11 further findings/corrections (A37–A47), including one material source-attribution defect in the first V2 draft. The most material V2 changes are:

1. replaced broad ACID language with explicit transaction contracts;
2. added isolation/anomaly mapping and serializable retry semantics;
3. distinguished serializability and linearizability;
4. expanded CAP into partition-scoped guarantees + normal-operation trade-offs;
5. added invariant-driven coordination and CRDT boundaries;
6. added dual-write/outbox/inbox/2PC/saga boundaries;
7. added derived-store contracts for cache/search/vector/analytics;
8. added sharding/partitioning/resharding standards;
9. expanded physical storage/index/compaction considerations;
10. separated replication from recovery;
11. added end-to-end restore acceptance and PITR dependencies;
12. added controlled corruption-repair standard;
13. classified migrations by operational risk, not syntax alone;
14. added DDL lock/rewrite/I/O/version verification;
15. added tenant fleet migration and failed-cohort quarantine;
16. expanded multi-tenancy from data rows to seven isolation planes;
17. added per-tenant recovery/export/delete/noisy-neighbor controls;
18. added lifecycle deletion across derived and backup copies;
19. added risk-tiered verification and production readiness;
20. added current source-status watch controls.

No audit finding was closed merely by adding prose; each BLOCKER/MAJOR finding was translated into a rule, decision framework, test, or operational artifact.


## 48.1 Second-pass corrections after the first V2 draft

The second assurance pass made additional changes rather than merely re-reading sources:

- corrected ISO/IEC 25012 attribution: its 15 named characteristics are now represented accurately; uniqueness/validity/relevance/provenance are labeled HOUSE/contextual additions;
- separated database structural integrity from semantic real-world accuracy;
- added ISO/IEC 5259-2:2024 as an analytics/ML data-quality overlay rather than pretending generic database quality is sufficient for ML;
- added mixed-version schema/application compatibility as an explicit migration correctness property using F1 evidence;
- added last-known-good recovery-point selection and post-restore truth validation for corruption/ransomware;
- added silent/latent data corruption as a first-class high-criticality failure mode;
- strengthened fleet-migration orchestration using Google’s >1M-database Datastore→Firestore migration evidence;
- replaced weak FoundationDB website-only evidence with the SIGMOD 2021 industry paper as the primary source;
- made PostgreSQL freshness precise to stable major 18 and current minor 18.6 while preserving PostgreSQL 19 Beta 4 as preview only;
- corrected SQL evidence to cite the 2023 base standard plus 2026 corrigendum, while keeping the next committee draft as watch-only;
- corrected the audit terminology from a six-plane to the canonical **seven-plane** tenant-isolation model.

---

# 49. Evidence map and annotated source register

> Source class records the strongest legitimate use, not an overall prestige ranking. Foundational papers can remain high-confidence for durable concepts; vendor documentation is authoritative for that implementation but not for universal technology choice.

## BASE00 — Master Playbook Standard v2.0-RC1
**Class:** Internal governing standard  
**Status:** REVIEWED, evidence cutoff 2026-09-27  
**Use:** outcome/evidence/decision/action/verification/learning chain; risk-proportionate rigor; normative language; claim taxonomy; audit/status discipline.  
**Limitation:** governs how playbooks are built, not database semantics.

## ENG00 — Universal Software & AI Engineering Master Playbook v2.0
**Class:** Internal governing engineering standard  
**Status:** V2 Golden Standard, cutoff 2026-09-27  
**Use:** explicit state/authority/ordering, constraints, transaction/concurrency, recovery, migrations, tenant/data quality interface.  
**Limitation:** delegates specialist database/storage depth to this playbook.

## SQL01 — ISO/IEC 9075-1:2023 / 9075-2:2023 + Technical Corrigenda 1:2026 — SQL Framework/Foundation
**URLs:** https://www.iso.org/standard/76583.html ; https://www.iso.org/standard/76584.html ; https://www.iso.org/standard/93690.html ; https://www.iso.org/standard/93691.html  
**Class:** E1 — International standard  
**Use:** current published SQL framework/foundation baseline and 2026 corrections.  
**Status:** 2023 editions remain published/current baselines; Technical Corrigenda 1 were published August 2026; successor committee drafts are under development.  
**Limitation:** individual database products implement/extend different subsets and semantics.

## SQL-WATCH01 — ISO/IEC CD 9075 — next SQL edition
**URLs:** successor-development records linked from ISO/IEC 9075-1:2023 and 9075-2:2023 lifecycle pages  
**Class:** E1-watch — committee draft under development  
**Use:** freshness watch only.  
**Rule:** MUST NOT be represented as the current final SQL edition.

## DQ01 — ISO/IEC 25012:2008 — Data quality model
**URL:** https://www.iso.org/standard/35736.html  
**Class:** E1 — International standard  
**Status:** reviewed/confirmed 2025, remains current.  
**Use:** general structured-data quality dimensions and evaluation framing.  
**Limitation:** not a universal numeric scoring system.

## REL01 — E. F. Codd — A Relational Model of Data for Large Shared Data Banks (1970)
**URL:** https://doi.org/10.1145/362384.362685  
**Class:** E3 — foundational peer-reviewed database research  
**Use:** relation-based modeling, logical data independence, normalization foundations.  
**Limitation:** does not prove relational storage is optimal for every modern workload.

## TXN01 — Härder & Reuter — Principles of Transaction-Oriented Database Recovery (1983)
**URL:** https://doi.org/10.1145/289.291  
**Class:** E3 — foundational transaction/recovery research  
**Use:** transaction/recovery principles and ACID-era conceptual foundation.  
**Limitation:** implementation techniques and hardware have evolved; use concepts, not 1983 implementation prescriptions.

## ISOLEVEL01 — Berenson et al. — A Critique of ANSI SQL Isolation Levels (1995)
**URL:** https://www.microsoft.com/en-us/research/publication/a-critique-of-ansi-sql-isolation-levels/  
**Class:** E3 — foundational database research  
**Use:** ambiguity of classic isolation phenomena; Snapshot Isolation; anomaly reasoning.  
**Limitation:** predates modern products but the semantic critique remains foundational.

## ISOLEVEL02 — Adya, Liskov & O'Neil — Generalized Isolation Level Definitions (2000)
**URL:** https://people.eecs.berkeley.edu/~adj/cs262/papers/icde00.pdf  
**Class:** E3 — peer-reviewed formal database research  
**Use:** implementation-independent isolation specifications.  
**Limitation:** formal model needs translation to actual engine semantics.

## SSI01 — Cahill, Röhm & Fekete — Serializable Isolation for Snapshot Databases
**URL:** https://doi.org/10.1145/1376616.1376690  
**Class:** E3 — peer-reviewed database research  
**Use:** snapshot-isolation anomalies and serializable snapshot isolation mechanisms.  
**Limitation:** product implementations differ.

## LIN01 — Herlihy & Wing — Linearizability (1990)
**URL:** https://doi.org/10.1145/78969.78972  
**Class:** E3 — foundational concurrency research  
**Use:** precise real-time correctness condition for concurrent objects.  
**Limitation:** linearizability of operations is not identical to serializability of transactions.

## CAP01 — Gilbert & Lynch — Brewer's Conjecture and the Feasibility of Consistent, Available, Partition-Tolerant Web Services (2002)
**URL:** https://doi.org/10.1145/564585.564601  
**Class:** E3 — formal distributed-systems research  
**Use:** scoped CAP impossibility result.  
**Limitation:** frequently overgeneralized; model/failure assumptions matter.

## PACELC01 — Daniel Abadi — Consistency Tradeoffs in Modern Distributed Database System Design (2012)
**URL:** https://doi.org/10.1109/MC.2012.33  
**Class:** E3/E7 — research/practitioner synthesis  
**Use:** normal-operation latency/consistency framing in addition to partitions.  
**Limitation:** PACELC is an organizing heuristic, not a complete consistency taxonomy.

## COORD01 — Bailis et al. — Coordination Avoidance in Database Systems
**URL:** https://arxiv.org/abs/1402.2237  
**Class:** E3 — peer-reviewed/formal database research  
**Use:** invariant confluence; determining when coordination is necessary for correctness.  
**Limitation:** application invariants must be modeled correctly.

## CRDT01 — Preguiça, Baquero & Shapiro — Conflict-Free Replicated Data Types (2018)
**URL:** https://arxiv.org/abs/1805.06358  
**Class:** E3 — research synthesis  
**Use:** convergence properties of CRDTs.  
**Limitation:** convergence does not automatically preserve arbitrary business invariants.

## COMMIT01 — Gray & Lamport — Consensus on Transaction Commit
**URL:** https://www.microsoft.com/en-us/research/publication/consensus-on-transaction-commit/  
**Class:** E3 — peer-reviewed distributed transaction research  
**Use:** transaction commit, consensus, 2PC/Paxos-commit relationships.  
**Limitation:** implementation choice still depends on infrastructure/failure model.

## SAGA01 — Garcia-Molina & Salem — Sagas (1987)
**URL:** https://doi.org/10.1145/38713.38742  
**Class:** E3 — foundational transaction/workflow research  
**Use:** long-lived transactions decomposed into subtransactions and compensation.  
**Limitation:** compensation is not atomic rollback; intermediate effects can be observable/irreversible.

## BTREE01 — Bayer & McCreight — Organization and Maintenance of Large Ordered Indexes (1970)
**URL:** https://doi.org/10.1145/1734663.1734671  
**Class:** E3 — foundational indexing research  
**Use:** balanced ordered index foundations.  
**Limitation:** modern implementations add concurrency, cache, storage and hardware behavior.

## LSM01 — O'Neil et al. — The Log-Structured Merge-Tree (1996)
**URL:** https://doi.org/10.1007/s002360050048  
**Class:** E3 — foundational storage/index research  
**Use:** write-oriented LSM architecture and trade-off basis.  
**Limitation:** modern engines differ substantially in compaction and read/write paths.

## UUID01 — RFC 9562 — Universally Unique IDentifiers
**URL:** https://www.rfc-editor.org/rfc/rfc9562.html  
**Class:** E4/E6 — Internet standard  
**Status:** published May 2024; obsoletes RFC 4122.  
**Use:** current UUID semantics including UUIDv7.  
**Limitation:** UUID selection remains workload/privacy/index-context dependent.

## JSON01 — RFC 8259 — The JavaScript Object Notation (JSON) Data Interchange Format
**URL:** https://www.rfc-editor.org/rfc/rfc8259.html  
**Class:** E4/E6 — Internet standard  
**Use:** number/interoperability boundary; common implementations use binary64-like precision constraints.  
**Limitation:** individual runtimes may support larger integer types outside default JSON number handling.

## NIST-STOR01 — NIST SP 800-209 — Security Guidelines for Storage Infrastructure
**URL:** https://csrc.nist.gov/publications/detail/sp/800-209/final  
**Class:** E4 — final government security guidance  
**Use:** storage security, protection, isolation, restoration-related controls.  
**Status:** final published baseline at cutoff.

## NIST-STOR-WATCH01 — NIST SP 800-209 Rev. 1 Initial Public Draft
**URL:** https://csrc.nist.gov/pubs/sp/800/209/r1/ipd  
**Class:** E4-watch — government draft  
**Status:** Initial Public Draft, 2026-07-22; comment period closed 2026-09-08.  
**Rule:** directional/watch evidence only; not final baseline.

## AWS-BACKUP01 — AWS Well-Architected REL09-BP04 — Periodic recovery testing
**URL:** https://docs.aws.amazon.com/wellarchitected/latest/framework/rel_backing_up_data_periodic_recovery_testing_data.html  
**Class:** E5/E6 — mature operational/vendor guidance  
**Use:** restore testing, backup integrity, RPO/RTO verification, application usability after restore.  
**Limitation:** AWS implementation context; principle generalizes more than specific services.

## CISA-BACKUP01 — CISA StopRansomware guidance
**URL:** https://www.cisa.gov/stopransomware  
**Class:** E4 — government security guidance  
**Use:** independent/offline/encrypted backups and recovery testing against destructive compromise.  
**Limitation:** ransomware focus; full DR needs broader failure analysis.

## AZ-TEN01 — Microsoft Azure Architecture Center — Multitenant storage/data approaches
**URL:** https://learn.microsoft.com/en-us/azure/architecture/guide/multitenant/approaches/storage-data  
**Class:** E5/E6 — mature operational/vendor architecture guidance  
**Use:** isolation spectrum, noisy neighbors, tenant recovery, geography, keys, migration, cost/complexity trade-offs.  
**Limitation:** Azure examples are platform-specific; topology principles are broader.

## PG-STATUS01 — PostgreSQL release/version status
**URLs:** https://www.postgresql.org/support/versioning/ ; https://www.postgresql.org/docs/release/ ; https://www.postgresql.org/about/news/postgresql-19-beta-4-released-3386/  
**Class:** E6 — official product documentation  
**Status at cutoff:** PostgreSQL 18 is the current stable major family; current minor is 18.6. PostgreSQL 19 Beta 4 was released 2026-09-24 and remains preview/beta, not the stable baseline.  
**Use:** version-status control and current-minor discipline.  
**Limitation:** PostgreSQL-specific and time-sensitive.

## PG-TXN01 — PostgreSQL 18 — Transaction Isolation
**URL:** https://www.postgresql.org/docs/18/transaction-iso.html  
**Class:** E6 — official product documentation  
**Use:** concrete Read Committed/Repeatable Read/Serializable behavior and serialization retry semantics.  
**Limitation:** PostgreSQL implementation, not universal SQL behavior.

## PG-CONSTRAINT01 — PostgreSQL 18 — Constraints
**URL:** https://www.postgresql.org/docs/18/ddl-constraints.html  
**Class:** E6 — official product documentation  
**Use:** concrete CHECK/NOT NULL/UNIQUE/PK/FK/exclusion behavior.  
**Limitation:** product-specific features/DDL details.

## PG-RLS01 — PostgreSQL 18 — Row Security Policies
**URL:** https://www.postgresql.org/docs/18/ddl-rowsecurity.html  
**Class:** E6 — official product documentation  
**Use:** RLS enforcement/default deny and owner/superuser/BYPASSRLS caveats.  
**Limitation:** PostgreSQL-specific; RLS is not a complete multi-tenant architecture.

## PG-BACKUP01 — PostgreSQL 18 — Backup and Restore / PITR
**URL:** https://www.postgresql.org/docs/18/backup.html  
**Class:** E6 — official product documentation  
**Use:** concrete dump/filesystem/continuous-archive/PITR distinctions.  
**Limitation:** PostgreSQL-specific.

## PG-LOCK01 — PostgreSQL 18 — Explicit Locking
**URL:** https://www.postgresql.org/docs/18/explicit-locking.html  
**Class:** E6 — official product documentation  
**Use:** concrete lock semantics and DDL/concurrency reasoning examples.  
**Limitation:** PostgreSQL-specific; every engine/version must be checked directly.

## PARQUET01 — Apache Parquet format
**URL:** https://parquet.apache.org/docs/  
**Class:** E4/E6 — open specification/project documentation  
**Use:** columnar analytical format, row-group/column-chunk and format compatibility concepts.  
**Status:** format ecosystem current at cutoff; preview/new encodings require reader support verification.  
**Limitation:** file format does not provide database transaction semantics.

## NIST-DI01 — NIST SP 1800-25 — Data Integrity: Identifying and Protecting Assets Against Ransomware and Other Destructive Events
**URL:** https://csrc.nist.gov/pubs/sp/1800/25/final  
**Class:** E4/E5 — final government applied cybersecurity guidance  
**Use:** destructive corruption threat model, asset identification, backups, secure storage, integrity checks, audit logs, and protection against ransomware/insider/honest-error destruction.  
**Limitation:** cybersecurity/data-integrity focus; does not define application transaction semantics.

## DYN01 — DeCandia et al. — Dynamo: Amazon's Highly Available Key-value Store (2007)
**URL:** https://doi.org/10.1145/1294261.1294281  
**Class:** E3/E5 — peer-reviewed industrial distributed-systems evidence  
**Use:** explicit availability/consistency trade-offs, versioning, application-visible conflict resolution.  
**Limitation:** Amazon's 2007 architecture and workload; not a universal NoSQL template.

## SPANNER01 — Corbett et al. — Spanner: Google's Globally-Distributed Database (2012)
**URL:** https://research.google/pubs/spanner-googles-globally-distributed-database-2/  
**Class:** E3/E5 — peer-reviewed industrial distributed-database evidence  
**Use:** globally distributed synchronous replication, distributed transactions, external consistency, explicit clock-uncertainty mechanisms.  
**Limitation:** sophisticated Google infrastructure; mechanism and guarantees generalize more than implementation economics.

## BIGTABLE01 — Chang et al. — Bigtable: A Distributed Storage System for Structured Data (2006)
**URL:** https://research.google/pubs/bigtable-a-distributed-storage-system-for-structured-data/  
**Class:** E3/E5 — peer-reviewed industrial storage-system evidence  
**Use:** scalable structured/wide-column storage and workload-specific distributed data layout.  
**Limitation:** Google-scale system and historical design; modern wide-column implementations vary.

## FDB01 — Zhou et al. — FoundationDB: A Distributed Unbundled Transactional Key Value Store (SIGMOD 2021)
**URL:** https://www.foundationdb.org/files/fdb-paper.pdf  
**Class:** E3/E5 — peer-reviewed industrial systems paper / mature operational evidence  
**Use:** strictly serializable distributed transaction design plus deterministic simulation/fault-testing as evidence that high-assurance database implementations can validate real code under complex failure sequences.  
**Limitation:** FoundationDB architecture and simulation framework are contextual implementation choices, not universal requirements.

---

## MLDQ01 — ISO/IEC 5259-2:2024 — Data quality for analytics and machine learning — Data quality measures
**URL:** https://www.iso.org/standard/81860.html  
**Class:** E1 — International standard  
**Status:** published 2024.  
**Use:** analytics/ML-specific data-quality measures/model; explicitly builds on ISO/IEC 25012 and ISO 8000.  
**Limitation:** applies to analytics/ML contexts; not a universal database transaction/storage standard.

## NIST-REC01 — NIST SP 1800-11 — Data Integrity: Recovering from Ransomware and Other Destructive Events
**URL:** https://csrc.nist.gov/pubs/sp/1800/11/final  
**Class:** E4/E5 — final government applied cybersecurity guidance  
**Use:** recovery from corruption/destructive events, trustworthy restored state, monitoring/audit to support recovery.  
**Limitation:** cybersecurity recovery context; application-specific semantic truth still requires domain validation.

## NIST-DETECT01 — NIST SP 1800-26 — Data Integrity: Detecting and Responding to Ransomware and Other Destructive Events
**URL:** https://csrc.nist.gov/pubs/sp/1800/26/final  
**Class:** E4/E5 — final government applied cybersecurity guidance  
**Use:** detecting data-integrity loss and supporting response/recovery timelines.  
**Limitation:** applied cybersecurity practice, not a database isolation/transaction specification.

## NIST-RANSOM01 — NIST IR 8374 Rev. 1 — Ransomware Risk Management: CSF 2.0 Community Profile
**URL:** https://csrc.nist.gov/pubs/ir/8374/r1/final  
**Class:** E4 — final government cybersecurity guidance  
**Status:** final June 2026.  
**Use:** current ransomware govern/protect/detect/respond/recover risk framing.  
**Limitation:** organization-level profile, not a storage-engine implementation standard.

## MIG01 — Rae et al. — Online, Asynchronous Schema Change in F1 (VLDB 2013)
**URL:** https://research.google/pubs/online-asynchronous-schema-change-in-f1/  
**Class:** E3/E5 — peer-reviewed industrial database research  
**Use:** demonstrates that mixed schema versions can cause anomalies/corruption and motivates phased compatibility protocols for online schema evolution.  
**Limitation:** F1 architecture is specific; the transferable principle is mixed-version compatibility and phase-safe evolution.

## MIG02 — Davisson et al. — Transparent Migration of Datastore to Firestore (2024)
**URL:** https://research.google/pubs/transparent-migration-of-datastore-to-firestore/  
**Class:** E3/E5 — industrial migration research  
**Use:** operational evidence for staged, zero-downtime, automated migration across more than one million databases.  
**Limitation:** Google-scale implementation; does not prescribe one universal migration mechanism.

## SDC01 — Bacon — Detection and Prevention of Silent Data Corruption in an Exabyte-scale Database System (IEEE 2022)
**URL:** https://research.google/pubs/detection-and-prevention-of-silent-data-corruption-in-an-exabyte-scale-database-system/  
**Class:** E3/E5 — peer-reviewed/industrial high-scale reliability evidence  
**Use:** silent hardware-path corruption as a real database failure mode; layered detection/prevention and faulty-hardware removal.  
**Limitation:** exabyte-scale Spanner context; control depth must remain risk-proportionate.

# 50. Evidence-to-rule map

| Rule area | Primary evidence |
|---|---|
| data/model quality | [REL01][DQ01][MLDQ01][ENG00] |
| SQL/constraints | [SQL01][PG-CONSTRAINT01] |
| isolation/anomalies | [ISOLEVEL01][ISOLEVEL02][SSI01][PG-TXN01] |
| linearizability | [LIN01] |
| CAP/normal distributed trade-offs | [CAP01][PACELC01][DYN01][SPANNER01] |
| coordination/convergence | [COORD01][CRDT01] |
| cross-resource commit/workflows | [COMMIT01][SAGA01] |
| identifiers/wire precision | [UUID01][JSON01] |
| indexing/storage structures | [BTREE01][LSM01][BIGTABLE01][PARQUET01] |
| recovery/security/corruption | [NIST-STOR01][NIST-DI01][NIST-REC01][NIST-DETECT01][NIST-RANSOM01][AWS-BACKUP01][CISA-BACKUP01][PG-BACKUP01][SDC01] |
| multi-tenancy | [AZ-TEN01][PG-RLS01] |
| online/fleet migration | [MIG01][MIG02][PG-LOCK01] |
| version/freshness | [PG-STATUS01][NIST-STOR-WATCH01][SQL-WATCH01] |
| verification/fault testing | [BASE00][ENG00][FDB01] |

---

# 51. Known limitations and boundary conditions

1. No universal benchmark can select a database without the actual workload and semantics.
2. Vendor documentation is authoritative for that vendor's behavior, not proof that the vendor/technology is optimal.
3. SQL standard conformance does not make every engine's isolation, DDL, replication, backup, or locking behavior identical.
4. CAP does not describe every practical distributed-system trade-off.
5. Serializability does not make remote external effects atomic.
6. Database constraints cannot express every cross-row/cross-system policy safely.
7. Recovery testing in one environment does not prove every disaster scenario.
8. RPO/RTO targets are business/risk decisions, not values this playbook can invent.
9. Tenant isolation requirements may become legally/contractually stricter than this generic standard.
10. Storage/security/privacy law changes require jurisdictional overlays.
11. PostgreSQL examples are intentionally examples; MySQL, SQL Server, Oracle, CockroachDB, Spanner, Dynamo-style stores, Cassandra-family systems, FoundationDB, object stores, and others have different semantics.
12. AI/agent memory/vector systems are fast-moving; this playbook covers state/integrity mechanics but not the full AI-memory evaluation problem.
13. Database-enforced structural integrity does not prove externally sourced facts are true; provenance and domain/process verification remain separate assurance problems.
14. Online schema compatibility is engine/application/version-specific; expand/contract is a pattern, not proof of safety without mixed-version verification.
15. Silent corruption controls depend heavily on platform/hardware/storage-stack capabilities and consequence; the playbook does not mandate one checksum/scrubbing design universally.

---

# 52. Freshness watchlist

Re-review immediately when any of these change:

| Watch item | Current at 2026-09-27 | Trigger |
|---|---|---|
| PostgreSQL | 18 stable major; current minor 18.6; 19 Beta 4 preview | PostgreSQL 19 GA or 18 minor change that alters cited behavior |
| SQL ISO/IEC 9075 | 2023 edition + 2026 corrigendum | next edition published |
| NIST SP 800-209 | 2020 final | Rev. 1 final publication |
| ISO/IEC 25012 | 2008 confirmed 2025 | revision/new edition |
| ISO/IEC 5259-2 | 2024 published | revision/new analytics/ML data-quality edition |
| UUID | RFC 9562 current | successor/errata materially changes guidance |
| Parquet | current open spec; new encodings/features evolving | adoption changes compatibility assumptions |
| cloud multi-tenancy guidance | current vendor docs | platform isolation/recovery semantics materially change |

---

# 53. V2 assurance note

This assurance note reflects both the original falsification audit and the second full research/sanity pass. “Best current standard” means evidence-weighted and current to the stated cutoff—not mathematically guaranteed perfect guidance for every future system.

## 53.1 What is strongly supported

**HIGH confidence**

- explicit state ownership and invariants;
- schema/constraint enforcement for expressible authoritative invariants;
- anomaly-aware transaction/isolation reasoning;
- distinction between serializability and linearizability;
- CAP boundary discipline;
- replication ≠ backup;
- restore testing as recovery evidence;
- expand/migrate/contract for live compatibility as a strong default;
- resumable/observable/reconcilable backfills;
- tenant isolation as a multi-dimensional architecture concern;
- version-aware official documentation for engine-specific behavior.

## 53.2 Strong contextual principles

**MODERATE–HIGH confidence, context-dependent**

- default relational store for constraint-rich transactional applications;
- serializable isolation when weaker semantics cannot be proven safe;
- RLS as defense in depth;
- UUIDv7 for distributed time-ordered identifiers;
- database-per-tenant for stronger isolation/recovery granularity;
- CRDTs for coordination-free convergent data types;
- LSM-oriented stores for write-heavy workloads;
- columnar formats for analytical scans.

## 53.3 HOUSE synthesis

These exact artifacts are deliberate house standards:

- 188 Golden Data Standards;
- seven-plane tenant isolation model;
- M0–M4 migration risk classes;
- the exact production-readiness and review checklists;
- the exact transaction/data/tenant/derived-store templates;
- the exact project brief and one-page Golden Standard.

They are derived from evidence but are not external ISO/NIST certifications.

---

# 54. Remaining validation gate

Before changing status from `REVIEWED` to `VALIDATED`, execute at least:

1. one non-author model/schema review using §33–35;
2. one concurrency test that deliberately exercises a race/invariant;
3. one representative-scale migration rehearsal using §37;
4. one isolated restore drill using §36;
5. one multi-tenant negative isolation test using §38 where applicable;
6. one controlled repair/reconciliation simulation;
7. closure or explicit risk acceptance of defects found;
8. regression review of changed sections.

This is intentional: Playbook 00 distinguishes a well-researched artifact from one demonstrated fit for actual operators and conditions.

---

# 55. Change log

## v2.0 — 2026-09-27 — Golden Master / REVIEWED

Built from V1 plus falsification audit and a second full research/freshness/sanity pass.

Material changes:

- expanded from 20 V1 principles to 188 root rules;
- added data quality and criticality models;
- added exact transaction/isolation/consistency vocabulary;
- added external side-effect and distributed-commit boundaries;
- added coordination/CRDT decision logic;
- added partition/shard/placement rules;
- added derived-store/cache/search/vector contracts;
- added physical storage/index/analytical-format lifecycle;
- added recovery-first backup architecture, PITR, and restore acceptance;
- added corruption/reconciliation/repair standard;
- added migration risk classes, backfill standard, fleet migration;
- added seven-plane tenant isolation model;
- added tenant movement/recovery/export/delete;
- added risk-tiered verification and data production readiness;
- added operational Plays, runbooks, templates, anti-patterns, contradiction ledger;
- added complete evidence/source register and freshness watchlist;
- explicitly separated PostgreSQL 18 stable from PostgreSQL 19 beta;
- explicitly separated NIST SP 800-209 final from Rev. 1 draft;
- explicitly preserved current SQL 2023 + 2026 corrigendum status.

## v1.0 — 2026-09-27 — DRAFT / SUPERSEDED

Initial synthesis used solely as the falsification target for V2.

---

# 56. Mechanical release audit

The final Golden Master passed a deterministic document QA pass after the V2 synthesis:

- 188/188 Golden Data Standards present in sequence;
- 45 evidence/source IDs used;
- 45 source definitions present;
- 0 missing evidence definitions;
- 0 dead source definitions;
- 0 unresolved construction-marker tokens in the substantive document;
- Markdown code fences balanced;
- assurance audit contains 47 findings with explicit V2 dispositions (36 first-pass + 11 second-pass);
- source-status controls distinguish stable/final publications from beta/draft/watch items.

Mechanical consistency is not field validation. The remaining validation gate in §54 still applies.
