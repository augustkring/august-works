# 15 — Backend, Services & Engine Engineering
## Production-grade evergreen standard for services, domain logic, jobs, workers, queues, engines, scheduling, multi-tenancy, and backend runtime architecture

```yaml
document_id: SE-15
title: Backend, Services & Engine Engineering
version: 2.0
status: REVIEWED
artifact_type: domain_capability_playbook
primary_archetype:
  - Operating
  - Execution
  - Decision
  - Response
inherits:
  - Master Playbook Standard v2.0-RC1
  - Universal Software & AI Engineering Master Playbook v2.0
evidence_cutoff: 2026-09-27
canonical_language: English
rigor_default: L3_CONTROLLED for production backends
rigor_escalation: L4_CRITICAL for safety, severe security/privacy, irreversible financial/state, or regulated high-consequence systems
volatility:
  principles: stable_to_moderate
  runtime_platform_details: fast
  security_platform_and_regulatory_details: fast_to_real_time
scope:
  - backend services
  - domain and application logic
  - background jobs and workers
  - queues and asynchronous processing
  - execution engines
  - scheduling
  - multi-tenancy
  - backend runtime lifecycle
  - overload, fairness, and backpressure
  - service operability
out_of_scope_as_primary_authority:
  - database/storage internals
  - API/protocol design in full depth
  - cloud/IaC platform implementation in full depth
  - security/privacy specialist controls in full depth
  - AI/LLM/agent behavior in full depth
  - language/runtime-specific style guides
```

> **Status note.** This V2 is a research-reviewed specialist standard, not a certification and not yet field-validated. Under the inherited Master Playbook Standard, production guidance reaches `VALIDATED` only after applicable non-author execution/scenario testing and closure or acceptance of material defects.

---

# Executive standard

A backend is not “the code behind the UI.” It is the system that owns authoritative behavior, state transitions, asynchronous work, execution, tenancy boundaries, resource admission, failure handling, and operational recovery.

The backend engineering chain is:

> **Intent → Domain invariant → Authority/state boundary → Execution contract → Resource budget → Failure semantics → Verification → Runtime evidence → Recovery → Learning**

The durable doctrine of this playbook is:

> **Keep domain truth explicit; give every state and side effect an owner; distribute only when a requirement earns the failure cost; assume retries, duplicates, reordering, delay, cancellation, process death, and dependency slowness; bound all work that can grow; isolate tenants and failure domains structurally; separate trigger from execution; make long-running work resumable or reconcilable; and operate every production path with enough evidence to detect, stop, repair, and learn from failure.**

This document deliberately rejects a universal “best” framework, queue, runtime, workflow engine, service topology, ORM, database, or cloud. The inherited engineering master standard explicitly treats architecture choices as contextual and requires the least complex system that can demonstrably meet its behavior and risk profile [BASE02].

---

# PART I — V1 WORKING STANDARD

## V1.1 Research protocol

**Decision supported:** define an evergreen production standard for backend/service/engine engineering that can govern ordinary SaaS through high-assurance systems without turning cloud-company implementation details into universal dogma.

**Primary questions**

1. What backend responsibilities remain stable across languages, frameworks, cloud providers, and architectures?
2. What failure semantics must be made explicit for synchronous and asynchronous execution?
3. What minimum controls are required for jobs, workers, queues, schedulers, and long-running engines?
4. What changes when the system is multi-tenant?
5. Which popular backend “best practices” fail under falsification?
6. Which controls should be mandatory only when consequence or scale warrants them?

**Evidence design**

- authoritative protocol/platform semantics for exact behavior;
- current international/engineering standards inherited through the master playbooks;
- mature production evidence from Google SRE and Amazon Builders’ Library;
- official Kubernetes/runtime documentation for scheduler/process lifecycle examples;
- official AWS/Azure SaaS guidance for multi-tenancy;
- OWASP standards/guidance for backend/application/API security;
- explicit contradiction search against microservices, exactly-once, “just add a queue,” cron certainty, and health-check folklore.

**Research boundary:** provider documentation is authoritative about that provider’s semantics, but provider architecture is not automatically a universal recommendation.

## V1.2 V1 architecture

V1 initially organized backend engineering around nine capabilities:

1. service boundaries and topology;
2. domain/application logic;
3. state, transactions, and concurrency;
4. request/response execution;
5. jobs and workers;
6. queues/events;
7. scheduling and engines;
8. multi-tenancy;
9. runtime reliability and operations.

## V1.3 V1 principles

V1 proposed these first-order rules:

1. Start from authoritative behavior and invariants, not framework structure.
2. Keep domain policy independent enough from transports and persistence to be verified without booting the entire runtime.
3. Prefer one deployable with strong internal modules until independent deployment, scaling, isolation, ownership, or compliance creates a real service boundary.
4. Give persistent state one authoritative owner and explicit mutation semantics.
5. Treat every remote dependency as fallible, slow, duplicating, unavailable, or stale.
6. Use deadlines and cancellation for remote/resource-consuming work.
7. Retry only transient, safe-to-repeat work with bounded attempts and backoff.
8. Design idempotency wherever retries or duplicate delivery are plausible.
9. Bound request concurrency, worker concurrency, queues, and retry amplification.
10. Use asynchronous work only when it buys a real property: long-running execution, buffering, decoupling, durability, retry/replay, or independent scaling.
11. Give every background job a durable identity and observable state.
12. Assume workers can die at any instruction boundary.
13. Acknowledge/dequeue only after the required durable outcome is established.
14. Quarantine poison work after bounded retries rather than looping forever.
15. Treat cron/scheduling as a trigger mechanism, not a correctness guarantee.
16. Make scheduled work idempotent and define missed-run and overlap policy.
17. Treat multi-tenant isolation as a system invariant.
18. Carry trusted tenant context across every relevant internal boundary.
19. Prevent one tenant from consuming unbounded shared capacity.
20. Separate liveness, readiness, and startup concerns.
21. Drain new work before shutdown and bound shutdown time.
22. Do not make correctness depend on graceful shutdown.
23. Instrument request, job, queue, scheduler, tenant, and engine paths with correlation and outcome signals.
24. Provide controlled repair, replay, and reconciliation paths for material state.
25. Test duplicates, reordering, cancellation, process death, dependency slowness, and overload—not only successful execution.

## V1.4 V1 service model

V1 used a semantic separation—not a mandated class/layer architecture:

```text
DOMAIN POLICY
  invariants, calculations, state transitions, business decisions

APPLICATION ORCHESTRATION
  use-case sequencing, authorization context, transaction/side-effect coordination

ADAPTERS
  HTTP/RPC, queue, database, vendor APIs, files, clocks, identity

RUNTIME
  process lifecycle, worker pools, scheduling, health, config, telemetry, resource control
```

The intent was to keep business truth from becoming accidental framework behavior while avoiding ritual “clean architecture” layering.

## V1.5 V1 asynchronous work model

```text
WORK ITEM
  stable business/job identity
        ↓
ATTEMPT
  one execution attempt with lease/deadline
        ↓
OUTCOME
  success | retryable failure | terminal failure | cancelled | quarantined
```

V1 required that attempt count, retryability, idempotency, deadline, concurrency, and terminal handling be explicit for material work.

## V1.6 V1 multi-tenant model

V1 treated tenancy as a cross-cutting context:

```text
AUTHENTICATED PRINCIPAL
        ↓
TRUSTED TENANT RESOLUTION
        ↓
AUTHORIZATION
        ↓
SERVICE / DOMAIN / DATA / CACHE / QUEUE / ENGINE
        ↓
TENANT-SCOPED TELEMETRY + RESOURCE POLICY
```

Isolation model could be pooled, bridged, stamped, or fully siloed, but cross-tenant access was prohibited regardless of topology.

## V1.7 V1 production-readiness gate

A V1 production backend passed only when:

- critical state/invariants and owners were known;
- every remote call had failure/deadline behavior;
- async delivery/retry/idempotency semantics were documented;
- queue and worker capacity were bounded;
- scheduler overlap/misfire behavior was explicit;
- tenant isolation and noisy-neighbor controls were tested where applicable;
- shutdown/drain and crash recovery were tested;
- telemetry covered user outcomes and internal work states;
- repair/reconciliation existed for materially corruptible state;
- rollback/roll-forward constraints were known.

---

# PART II — V1 FALSIFICATION / SANITY AUDIT

## A. Audit method

V1 was challenged from ten perspectives:

1. small-team product backend;
2. modular-monolith maintainer;
3. service/distributed-systems architect;
4. SRE/on-call operator;
5. queue/worker operator;
6. scheduler/time-semantics operator;
7. SaaS/multi-tenant architect;
8. application-security reviewer;
9. high-assurance/state-integrity reviewer;
10. long-running engine/workflow maintainer.

The audit attempted to break V1 using duplicate delivery, partial commits, stale leases, reordering, process death, overload, slow dependencies, deployment overlap, tenant abuse, scheduler downtime, daylight-saving/timezone changes, replay, poison messages, stale configuration, and emergency repair.

## B. Material audit findings

| ID | Severity | V1 defect or ambiguity | Why it matters | V2 disposition |
|---|---|---|---|---|
| A01 | BLOCKER | “Idempotent job” was too vague | A job can be replay-safe at transport level but still duplicate a business effect | Separate work identity, attempt identity, idempotency scope, and effect key |
| A02 | BLOCKER | Scheduler semantics were under-specified | Real schedulers can miss or duplicate triggers; overlap changes business outcome | Add timezone, lateness, misfire/catch-up, overlap, occurrence identity, and deadline contract |
| A03 | BLOCKER | Tenant context propagation lacked a trust rule | A client-supplied tenant ID can become cross-tenant authorization bypass | Tenant selection is never authorization; bind context to authenticated server-side authority |
| A04 | MAJOR | “Use queue for backpressure” could imply queues solve sustained overload | Queue backlog can simply defer collapse | Add admission control, backlog age, service rate, fairness, and overload termination rules |
| A05 | MAJOR | “Exactly once” handling was not explicit enough | Broker-specific exactly-once does not automatically create exactly-once business effects | Make end-to-end exactly-once a scoped proof obligation; default to duplicate-tolerant effects |
| A06 | MAJOR | Worker shutdown did not explicitly stop intake before drain | Workers can pull work they cannot finish before termination | Add stop-intake → drain/extend lease → checkpoint/release → bounded exit |
| A07 | MAJOR | Graceful shutdown could be misread as correctness protection | Processes can be killed without cleanup | Correctness MUST survive abrupt death; graceful shutdown is optimization/risk reduction |
| A08 | MAJOR | Distributed singleton/lock guidance lacked stale-owner protection | Expired owner can resume and overwrite a new owner | Add fencing/version conditions where stale writers are plausible |
| A09 | MAJOR | Multi-tenancy focused on access more than performance isolation | One tenant can deny service to others without crossing data boundaries | Add quotas, fairness, resource partitions, per-tenant limits, and noisy-neighbor tests |
| A10 | MAJOR | “Health check” was underspecified | Bad liveness checks can create restart cascades | Separate startup/readiness/liveness and keep liveness scoped to locally recoverable failure |
| A11 | MAJOR | Engine state was not modeled separately from job state | Long-running engines need versioned durable execution, progress, checkpoint/resume, cancellation | Add full Engine Execution Contract |
| A12 | MAJOR | No explicit control-plane/data-plane model | Tenant provisioning/config/admin failure can leak into user serving path or vice versa | Add separation and different availability/authorization expectations |
| A13 | MAJOR | Domain side effects lacked an explicit commit point | Retrying after unknown partial outcome creates duplicate external effects | Add effect state, outbox/inbox or equivalent, reconciliation, and unknown-outcome handling |
| A14 | MAJOR | DLQ could be treated as “handled” | Dead-lettered work can silently become permanent data loss | DLQ/quarantine requires owner, reason, alert, retention, repair/replay and closure evidence |
| A15 | MAJOR | Queue scaling could be driven by depth alone | Heterogeneous work makes depth misleading | Require age/lag, arrival rate, completion rate, processing distribution, and saturation |
| A16 | MAJOR | Scheduled catch-up was not bounded | Outage recovery can create a thundering herd of missed jobs | Add bounded catch-up policy and priority/resource budget |
| A17 | MAJOR | Tenant-specific branching was not addressed | Hard-coded customer logic creates drift and untestable variants | Model capability/configuration explicitly; prohibit invisible per-customer forks by default |
| A18 | MAJOR | Runtime configuration failure semantics were incomplete | Silent defaults can change security or behavior during deploy | Typed validation, fail-closed for material config, provenance/version, controlled reload |
| A19 | MINOR | “Thin controllers” language risked framework dogma | Thinness is not the objective; authority/invariant placement is | Replace with semantic ownership rule |
| A20 | MINOR | Too many telemetry examples used tenant IDs naively | High-cardinality labels can explode metrics cost | Use logs/traces or controlled dimensions; keep metrics-cardinality budget explicit |

## C. Research findings that changed V2

### C1. Queue semantics must assume duplicate execution unless a stronger scoped guarantee is proven

Amazon SQS documents at-least-once delivery and requires consumers to tolerate duplicate delivery. Google Cloud Tasks explicitly states that duplicate execution can occur because guaranteed execution is favored over absolute duplicate prevention. Google Pub/Sub’s exactly-once mode is constrained by subscription type/region and does not collapse duplicate publishes into one business operation [S15][S16][S17].

**V2 correction:** “Exactly once” is not accepted as an end-to-end architecture claim without defining the exact boundary, identity, acknowledgement, producer, consumer, side effect, and failure assumptions.

### C2. Scheduling is approximate in real control planes

Kubernetes CronJob documentation states that under some circumstances two Jobs can be created or no Job can be created, and therefore Jobs should be idempotent. It also exposes explicit overlap, missed-run deadline, suspension, and timezone behavior [S06].

**V2 correction:** scheduled business work receives an occurrence identity and must define duplicate, overlap, late, missed, and catch-up behavior.

### C3. Overload is a correctness concern, not only performance tuning

Google SRE and Amazon production guidance show that retries, growing in-flight work, slow dependencies, unbounded queues, and synchronized recovery can amplify small failures into cascading outages [S02][S03][S04].

**V2 correction:** bounded concurrency, admission control, retry budgets, and failure-domain isolation become root backend requirements.

### C4. Multi-tenancy needs both confidentiality isolation and resource fairness

AWS SaaS guidance calls tenant isolation foundational while explicitly rejecting one universal isolation topology. AWS and Azure guidance also emphasize quotas/noisy-neighbor protection and monitoring per tenant [S05][S10][S11].

**V2 correction:** isolation is defined across authorization, data, caches, messaging, execution, secrets, and resource consumption.

### C5. Runtime health and shutdown need separate semantics

Kubernetes distinguishes startup, readiness, and liveness, and warns that incorrect liveness behavior can cause cascading failure. Kubernetes and gRPC both model graceful termination as a bounded transition where new work stops and in-flight work gets an opportunity to finish [S07][S08][S09].

**V2 correction:** every process has an explicit lifecycle; readiness gates traffic, liveness is not a dependency oracle, and correctness cannot depend on graceful cleanup.

## D. V1 verdict

V1 had the right architecture but under-specified the failure semantics that distinguish a production backend from a clean codebase. V2 therefore preserves the V1 principles while strengthening:

- execution identity;
- durable state transitions;
- overload/backpressure;
- duplicate handling;
- scheduler semantics;
- tenant fairness;
- process lifecycle;
- repair/reconciliation;
- engine durability/versioning;
- evidence and auditability.

No audit finding justified a universal requirement for microservices, event sourcing, CQRS, a specific workflow engine, a specific queue, Kubernetes, a specific cloud, repository layers, or “clean architecture.” Those remain implementation choices.

---

# PART III — V2 GOLDEN MASTER

# 1. Purpose, scope, and inherited obligations

## 1.1 Purpose

This playbook defines how to engineer backend systems that remain correct and operable under concurrency, partial failure, retries, duplicate work, changing load, deployment, tenant sharing, long-running execution, and maintenance.

It specializes the inherited engineering doctrine around:

- authoritative domain behavior;
- service/runtime boundaries;
- jobs/workers;
- asynchronous queues/events;
- schedulers/timers;
- execution engines;
- multi-tenancy;
- production process lifecycle;
- overload, fairness, and repair.

## 1.2 Inherited rules

The Master Playbook Standard defines playbooks as operational knowledge systems rather than long documents, and requires risk-proportionate evidence, decision logic, verification, evaluation, learning, and traceability [BASE01]. Production software/AI guidance is classified as R3/L3 by default and escalates to R4/L4 where consequence requires it [BASE01].

The Universal Software & AI Engineering Master Playbook requires explicit state, ordering, authority, finite deadlines, safe retries, idempotency, bounded queues/concurrency, overload control, observability, recoverable change, and risk-based verification [BASE02]. This specialist standard MUST NOT weaken those rules.

## 1.3 Specialist-playbook boundaries

This standard owns backend execution semantics. It SHOULD be combined with deeper specialist standards when the decision crosses their domains:

- Requirements/specification: external and behavioral requirements.
- Architecture/system design: system-wide quality trade-offs.
- Verification/testing: assurance portfolio and evidence depth.
- Security: threat models, secure development, cryptography, identity.
- Privacy: personal-data purpose, access, retention, deletion.
- Reliability/SRE: SLOs, incidents, resilience, recovery.
- Performance/cost: profiling, capacity, resource economics.
- DevOps/supply chain: CI/CD, provenance, release infrastructure.
- Data/storage: transactions, storage engines, schemas, backups.
- API/distributed systems: external contracts, events, protocol details.
- Cloud/IaC: infrastructure and network implementation.
- AI/LLM/agent engineering: probabilistic engines and autonomous action.
- Language/runtime profiles: language-specific concurrency/memory/runtime details.

---

# 2. Backend system model

## 2.1 Canonical execution surfaces

A backend may contain some or all of these surfaces:

| Surface | Primary responsibility | Typical failure concern |
|---|---|---|
| Request service | bounded synchronous interaction | latency, dependency failure, overload |
| Domain module | authoritative rules/invariants | invalid state, duplicated policy |
| Application orchestrator | use-case sequencing/side effects | partial completion, wrong transaction boundary |
| Worker | asynchronous work execution | duplicate work, crash, poison input |
| Queue/broker | buffering/delivery | backlog, redelivery, ordering, retention |
| Scheduler | time-based trigger creation | duplicates, misses, lateness, overlap, timezone |
| Engine | durable/complex execution | restart, version drift, checkpoint, cancellation |
| Control plane | provisioning/config/admin/tenant lifecycle | privilege, fleet-wide blast radius |
| Data plane | serving tenant/user workload | correctness, isolation, SLO, fairness |
| Repair/reconciliation plane | controlled correction/replay | privilege, accidental repeat/destruction |

Not every system needs every surface. Do not split one process into many deployables simply because the table names them separately.

## 2.2 Core state objects

V2 distinguishes identities that weak systems often collapse:

```text
BUSINESS INTENT / COMMAND
    stable meaning requested by an actor

WORK ITEM
    durable unit that should eventually reach a terminal business state

ATTEMPT
    one execution try; may happen many times

SIDE EFFECT
    externally observable mutation or call

SCHEDULE OCCURRENCE
    one intended firing of a recurring schedule

ENGINE EXECUTION
    durable long-running execution with its own state/version
```

Duplicate `ATTEMPT`s MUST NOT silently create duplicate `BUSINESS INTENT` effects.

---

# 3. Risk and criticality model for backend work

Production backends are normally **L3 / CONTROLLED** under the inherited Master Playbook Standard because they can have material customer impact, sensitive data, broad blast radius, and substantial organizational dependency [BASE01].

Escalate toward L4 when any path can cause:

- physical/safety harm;
- irreversible financial transfer or custody loss;
- severe privacy/security impact;
- unrecoverable data corruption/deletion;
- regulatory high-consequence failure;
- broad credential/privilege change;
- autonomous high-impact action;
- systemic cross-tenant exposure.

Rigor increases through stronger independence, traceability, concurrency/failure testing, controlled release, formal methods where suitable, and explicit risk acceptance—not by adding generic documents.

---

# 4. Golden Backend Standards

These rules are the root normative layer of V2.

## A. Intent, authority, and boundaries

1. **MUST define the authoritative business outcome and unacceptable failure before selecting backend topology or framework.**
2. **MUST identify the owner and source of truth for each material persistent fact.**
3. **MUST make material state transitions and invariants explicit enough to test or enforce.**
4. **MUST distinguish identity/authentication from authorization and business policy.**
5. **MUST treat every trust-boundary crossing as a validation and authorization event appropriate to the context.**
6. **SHOULD prefer one deployable with strong internal boundaries until an independent deployment/scaling/failure/security/ownership requirement earns a network boundary.**
7. **MUST NOT introduce distributed-system complexity solely because microservices are fashionable.**
8. **SHOULD record consequential service-boundary decisions and their reversal triggers.**

## B. Domain and application logic

9. **MUST keep each business invariant in one canonical semantic home.**
10. **SHOULD separate domain policy from transport, persistence, and vendor mechanics enough that the policy can be reasoned about and verified independently.**
11. **MUST NOT duplicate authoritative business rules independently across services, workers, controllers, database triggers, and clients without an explicit consistency design.**
12. **SHOULD represent material lifecycle rules as explicit state transitions rather than scattered boolean combinations.**
13. **MUST define the transaction/commit boundary for commands that mutate authoritative state.**
14. **MUST define how externally visible side effects relate to that commit boundary.**
15. **SHOULD make nondeterministic inputs such as current time, random values, external reads, and generated IDs explicit dependencies when they materially affect testability/replay.**
16. **MUST preserve causally relevant provenance for high-impact decisions or automated actions.**

## C. Synchronous execution

17. **MUST give remote/resource-consuming operations a finite deadline, timeout, cancellation policy, or explicit reason they are intentionally unbounded.**
18. **MUST define success, validation error, authorization failure, conflict, overload, transient failure, timeout/cancellation, and terminal failure semantics where they affect caller behavior.**
19. **MUST classify retryability by operation semantics, not merely by generic exception or status class.**
20. **MUST NOT retry non-idempotent side effects automatically unless deduplication/idempotency or evidence of non-application makes retry safe.**
21. **MUST propagate cancellation/deadline where downstream work would otherwise continue consuming material resources after the caller has abandoned it.**
22. **SHOULD isolate slow/high-risk dependency paths so they cannot consume all concurrency needed by unrelated healthy paths.**

## D. Jobs and workers

23. **Every material job MUST have a stable work identity distinct from execution attempts.**
24. **Every retryable job MUST define idempotency or deduplication semantics for its business effect.**
25. **Workers MUST assume they can crash after any external side effect and before acknowledgement.**
26. **A worker MUST mark/acknowledge success only after the required durable outcome for that attempt is established.**
27. **Long-running attempts SHOULD expose heartbeat/lease/progress semantics where loss detection matters.**
28. **Lease expiry MUST NOT authorize a stale worker to commit over a newer owner when that race could corrupt state; use fencing/version checks or another ownership proof where necessary.**
29. **Retries MUST be bounded by attempts, elapsed time, deadline, cost, or another explicit budget.**
30. **Retry delay SHOULD de-correlate workers when synchronized retries can amplify failure.**
31. **Terminally failing or repeatedly poison work MUST transition to an owned quarantine/dead state rather than retry forever.**
32. **Quarantined work MUST have reason, retention, owner, repair/replay method, and closure/expiry policy where the work is material.**
33. **Workers MUST bound concurrency and memory/in-flight work.**
34. **Workers SHOULD stop intake before shutdown drain.**
35. **Correctness MUST survive abrupt process death; graceful worker shutdown cannot be the sole integrity mechanism.**

## E. Queues and events

36. **Before adopting a queue, MUST define the requirement it earns: buffering, durable asynchronous execution, fan-out, decoupling, retry/replay, or independent scaling.**
37. **MUST define actual provider delivery semantics and MUST NOT infer “exactly once” from marketing terminology.**
38. **Consumers SHOULD tolerate duplicate delivery unless a stronger end-to-end proof exists.**
39. **MUST define ordering scope: none, per key, partition, workflow, transaction, or stronger.**
40. **MUST define acknowledgement/lease/visibility semantics and what happens after consumer death.**
41. **MUST define retention, expiry, maximum age, and stale-work policy.**
42. **MUST define backlog/overload policy; a queue MUST NOT be treated as infinite capacity.**
43. **MUST expose enough telemetry to distinguish arrival-rate growth, processing slowdown, retry amplification, poison work, and downstream saturation.**
44. **SHOULD separate critical and best-effort workload when one backlog can starve the other.**
45. **Replay MUST be treated as a production mutation with authorization, scope, idempotency, observability, and stop controls.**

## F. Scheduling

46. **Every material recurring schedule MUST define timezone semantics explicitly.**
47. **MUST define occurrence identity independently from actual execution time.**
48. **MUST define late/missed-run policy: skip, run once, bounded catch-up, or another explicit rule.**
49. **MUST define overlap policy: allow, serialize/forbid, replace/cancel, or key-partitioned concurrency.**
50. **Scheduled work MUST tolerate duplicate trigger creation unless the scheduler contract proves otherwise.**
51. **MUST define maximum useful lateness/deadline where old work can become harmful or irrelevant.**
52. **Catch-up after scheduler downtime MUST be bounded so recovery cannot create uncontrolled backlog or load spikes.**
53. **Business correctness MUST NOT depend on a cron controller firing at an exact instant.**
54. **SHOULD separate schedule trigger creation from the durable execution mechanism for non-trivial work.**

## G. Engines and long-running execution

55. **Every material engine execution MUST have a durable execution identity, version, input contract, state, owner, and terminal outcome.**
56. **MUST define whether execution is deterministic, replayable, resumable, restart-from-zero, or inherently non-replayable.**
57. **MUST define checkpoint/resume semantics when restart cost or duration makes restart-from-zero unacceptable.**
58. **MUST define cancellation and what cancellation can and cannot reverse.**
59. **MUST separate engine progress from externally committed side effects.**
60. **MUST version long-running workflow/engine semantics so an execution that spans deployments has defined behavior.**
61. **SHOULD prefer a mature durable workflow/runtime when requirements include long-lived timers, durable retries, fan-out/fan-in, human approvals, compensation, and execution across process/deploy failure—unless bespoke ownership is justified.**
62. **MUST NOT store the only authoritative state of a material long-running execution in volatile process memory.**

## H. Runtime lifecycle and resource safety

63. **Every production process MUST have defined startup, readiness, run, drain, shutdown, and crash behavior.**
64. **Startup/readiness MUST validate the minimum conditions required to safely accept the relevant work.**
65. **Liveness MUST indicate a locally recoverable stuck/broken process condition; it SHOULD NOT indiscriminately fail because a shared downstream dependency is temporarily unavailable.**
66. **Shutdown SHOULD stop new work, drain or checkpoint in-flight work, release/close resources, and exit within a finite deadline.**
67. **MUST design for forceful termination after the grace deadline.**
68. **MUST bound thread/task pools, DB connections, sockets, buffers, batch size, and other finite resources where exhaustion is plausible.**
69. **MUST treat latency-driven concurrency as overload risk, not only request-rate spikes.**
70. **SHOULD isolate workloads/dependencies with different failure or latency profiles when shared resource exhaustion creates unacceptable blast radius.**

## I. Multi-tenancy

71. **Tenant isolation is a mandatory invariant for multi-tenant systems.**
72. **A client-provided tenant identifier MUST NOT by itself authorize access; tenant context MUST be bound to authenticated server-side authority.**
73. **Trusted tenant context MUST propagate across services, workers, queues, engines, caches, data access, and repair tools where tenant scope matters.**
74. **MUST include tenant scope in authorization for every tenant-owned resource operation.**
75. **MUST ensure caches, deduplication keys, idempotency keys, object names, queues/topics, and temporary storage cannot collide across tenant boundaries unless intentionally global.**
76. **MUST select isolation topology per component based on risk, compliance, scale, cost, performance, and operational complexity rather than one universal tenancy model.**
77. **MUST protect shared capacity from noisy-neighbor failure through quotas, admission control, scheduling fairness, partitioning, or equivalent controls where one tenant can materially affect others.**
78. **SHOULD observe both fleet-wide and tenant-scoped health/consumption where diagnosis and fairness require it.**
79. **MUST automate tenant lifecycle operations that create or destroy sensitive resources when manual drift would create material risk.**
80. **SHOULD model tenant-specific variation as controlled configuration/capability/tier policy rather than hard-coded customer branches.**
81. **MUST define offboarding/deletion/export and credential revocation behavior for tenant lifecycle.**

## J. Security, observability, repair, and change

82. **Internal network location MUST NOT be treated as sufficient authentication or authorization for privileged backend communication.**
83. **Background workers, schedulers, engines, and repair tools MUST receive only the permissions required for their work.**
84. **Privileged repair/replay operations MUST be auditable and SHOULD be reversible or scoped/bounded where possible.**
85. **Telemetry MUST correlate request/work/execution/deployment while minimizing secrets and sensitive data.**
86. **MUST observe domain-correctness signals in addition to CPU/memory/uptime.**
87. **Material changes MUST be observable after deployment and have a stop, rollback, roll-forward, or containment path appropriate to state compatibility.**
88. **MUST test recovery/repair paths that the production model depends on.**
89. **MUST preserve enough operational history to distinguish content/input defects, dependency failure, overload, retry amplification, tenant abuse, and runtime defects.**
90. **MUST convert recurring incidents, manual repair, and repeated operator improvisation into system, control, or runbook improvement.**

---

# 5. Service and runtime architecture

## 5.1 Default topology decision

Use the inherited decision rule:

```text
Need independent scaling, deployment, failure isolation, security boundary,
or ownership?
  ├─ NO → prefer one deployable with strong internal modules
  └─ YES → can an internal boundary still satisfy it?
             ├─ YES → preserve simpler topology
             └─ NO  → extract the justified runtime/service boundary
```

The purpose is not to prefer monoliths ideologically. It is to charge every network boundary for its real costs:

- distributed failure;
- version compatibility;
- serialization;
- independent deployment state;
- operational ownership;
- latency;
- tracing;
- authentication;
- retries/idempotency;
- partial failure;
- data ownership.

## 5.2 Strong service-boundary signals

A service boundary becomes more defensible when several of these are true:

- independent scaling profile;
- distinct failure containment requirement;
- independent security/trust boundary;
- materially different latency/resource profile;
- independent release cadence;
- stable domain ownership boundary;
- independent data ownership;
- separate compliance/residency need;
- distinct operator/team responsibility;
- technology/runtime requirement that materially improves outcome.

A noun in the domain model is not automatically a microservice.

## 5.3 Deployment unit vs module

A **module** is a reasoning/change boundary. A **service/process** is an operational boundary. Keep those concepts separate.

Do not create a new service only to obtain code organization. Do not keep unrelated failure domains in one process only to avoid service count.

## 5.4 Control plane vs data plane

For systems with fleet/tenant administration, explicitly distinguish:

**Data plane**
- serves ordinary user/tenant workload;
- high availability and predictable latency often dominate;
- should not depend synchronously on optional administrative systems where avoidable.

**Control plane**
- provisions, configures, migrates, grants, rotates, schedules, or administers resources;
- usually more privileged;
- can have lower request volume but much larger blast radius;
- requires stronger audit, idempotency, authorization, and rollout controls.

Control-plane failure MUST NOT silently mutate tenant/data-plane state outside a recoverable state machine.

---

# 6. Domain logic and application orchestration

## 6.1 Semantic separation, not layer theater

V2 does not mandate DDD, hexagonal architecture, Clean Architecture, service classes, repositories, CQRS, or a specific folder structure.

It requires that the system can identify:

```text
WHAT IS TRUE?       → domain invariant/policy
WHO MAY DO IT?      → authorization/business policy
WHAT CHANGES?       → state transition/transaction
WHAT IS CALLED?     → side effect/dependency
WHAT IF IT FAILS?   → failure/retry/reconciliation semantics
WHO OWNS IT?        → module/service/operator
```

## 6.2 Domain policy

Domain policy SHOULD:

- use domain terms;
- make invalid transitions rejectable;
- avoid hidden network/I/O where that obscures cost/failure;
- be deterministic where practical;
- expose conflicts instead of last-write-wins by accident;
- preserve one canonical implementation for material rules.

## 6.3 Application orchestration

Application orchestration owns the use-case sequence around domain policy:

1. resolve trusted actor/tenant/context;
2. validate input and preconditions;
3. authorize the command;
4. load/establish required state;
5. evaluate domain transition;
6. persist authoritative change within the intended atomicity boundary;
7. establish side-effect intent;
8. emit/dispatch external work safely;
9. return an outcome the caller can interpret.

This is a logical sequence, not a mandate that every system uses one transaction or synchronous path.

## 6.4 Side effects and unknown outcomes

If the system mutates local state and performs a remote side effect, it MUST decide what happens when only one succeeds.

Valid strategies include, depending on domain:

- make the remote effect idempotent and reconcile;
- persist an outbox/intent then dispatch asynchronously;
- use a provider transaction primitive if it truly spans the boundary;
- compensate;
- hold an explicit `UNKNOWN/PENDING_RECONCILIATION` state;
- require human resolution for high-consequence ambiguity.

Do not lie to the model with a “transaction” abstraction that does not actually cover the remote boundary.

## 6.5 Long transactions

Avoid holding scarce database locks/transactions open across uncontrolled remote calls unless the storage/protocol model explicitly supports and requires it. Long transactions couple dependency latency to lock duration and capacity.

---

# 7. State, concurrency, ownership, and time

## 7.1 State ownership record

For every material state set:

```yaml
state_or_fact:
source_of_truth:
semantic_owner:
writers:
readers:
tenant_scope:
consistency_model:
mutation_rules:
concurrency_control:
ordering_scope:
retention:
recovery:
repair_authority:
```

## 7.2 Concurrency strategy

Choose intentionally among mechanisms such as:

- database transaction/constraint;
- optimistic version compare-and-set;
- serialization/partition ownership;
- local mutex only for process-local state;
- distributed lease/lock with stale-owner protection;
- append/ledger + reconciliation;
- commutative operation/conflict merge where domain allows.

A distributed lock name is not a correctness proof.

## 7.3 Fencing stale owners

When a lease can expire while the old worker continues running, a new owner can coexist with a stale owner. If a stale writer could corrupt state, use an ownership/version/fencing token checked by the authoritative resource before commit.

## 7.4 Ordering

Document whether order means:

- wall-clock timestamp;
- causal order;
- queue partition order;
- database serialization order;
- sequence number/version;
- user-visible order.

Do not infer causal/global order from timestamps alone [BASE02].

## 7.5 Clocks

Use wall-clock time for business timestamps and schedules; use monotonic elapsed-time facilities where the runtime provides them for local durations/timeouts. Define timezone and daylight-saving behavior for human schedules.

---

# 8. Synchronous request/service execution

## 8.1 Request budget

A material request path SHOULD know:

```yaml
request_deadline:
max_dependency_time:
retry_budget:
max_inflight_concurrency:
max_payload_or_work_units:
rate_or_admission_policy:
cancellation_behavior:
degraded_mode:
```

The sum of downstream timeout/retry plans SHOULD fit the caller’s useful deadline rather than exceed it by construction.

## 8.2 Retry taxonomy

Retry only when all applicable conditions hold:

- failure is plausibly transient;
- the operation is safe to repeat or deduplicated;
- enough deadline remains;
- retry does not violate a quota or side-effect/cost limit;
- the dependency is not already signaling overload;
- a retry at this layer does not multiply an existing lower-layer retry loop.

RFC 9110 explicitly warns against automatic retry of non-idempotent requests unless the client knows repetition is safe [S01]. Google SRE and Amazon operational guidance show that retries can amplify overload [S02][S03].

## 8.3 Dependency isolation

For dependency/path isolation, choose the lightest effective mechanism:

- independent semaphore/concurrency budget;
- separate worker pool;
- separate queue;
- rate limit;
- cache/stale fallback;
- circuit breaker when its state/complexity is justified;
- separate process/service only when isolation needs justify it.

Amazon operational guidance emphasizes that slow dependencies can increase concurrency until unrelated paths fail, and uses bulkhead/dependency isolation to contain that effect [S04].

---

# 9. Job engineering standard

## 9.1 Canonical job contract

```yaml
job_type:
job_schema_version:
work_id:
tenant_id_or_scope:
requested_by:
created_at:
not_before:
deadline_or_expiry:
priority:
idempotency_scope:
business_effect_key:
max_attempts:
max_elapsed_retry_time:
backoff_policy:
max_attempt_runtime:
concurrency_key_or_limit:
lease_or_heartbeat:
cancellation_policy:
input_reference_or_payload:
output_contract:
side_effects:
terminal_failure_policy:
quarantine_policy:
observability:
owner:
```

Fields may be implemented differently, but the semantics MUST be recoverable for material jobs.

## 9.2 Work identity vs attempt identity

**Work identity** answers: “Is this the same intended work?”  
**Attempt identity** answers: “Which execution tried it?”

Telemetry and audit SHOULD retain both.

## 9.3 Job state machine

Recommended house model:

```text
PENDING
  → CLAIMED
  → RUNNING
  → SUCCEEDED
  → FAILED_RETRYABLE → PENDING
  → FAILED_TERMINAL
  → CANCELLED
  → QUARANTINED
```

Lease expiry MAY move abandoned work back to claimable state, but MUST account for stale workers still executing.

## 9.4 Acknowledgement/commit ordering

Default invariant:

> Do not acknowledge/delete the durable work item before the outcome that acknowledgement represents is durably established.

If an external side effect cannot participate in the same atomic boundary, use idempotency plus durable intent/result tracking and reconciliation.

## 9.5 Poison jobs

A poison job is work that predictably fails repeatedly due to input, state, code, or dependency semantics rather than transient conditions.

Required controls for material poison work:

- bounded retry;
- terminal reason category;
- payload/input provenance;
- safe redaction;
- quarantine owner;
- investigation/repair workflow;
- replay preconditions;
- replay batch/rate limit;
- closure evidence.

## 9.6 Cancellation

Cancellation states MUST distinguish:

- requested but not started;
- requested while running;
- cooperatively stopped before side effect;
- side effect already committed;
- compensation/reversal possible;
- cancellation no longer possible.

“Cancelled” MUST NOT imply “nothing happened” unless the system can prove that.

---

# 10. Worker engineering standard

## 10.1 Worker lifecycle

```text
START
  → VALIDATE CONFIG/IDENTITY
  → READY TO CLAIM
  → CLAIM WORK
  → EXECUTE WITH BUDGET
  → COMMIT/ACK OR CLASSIFY FAILURE
  → REPEAT

SHUTDOWN:
STOP CLAIMING
  → DRAIN/CHECKPOINT/RELEASE
  → FLUSH BOUNDED TELEMETRY
  → CLOSE RESOURCES
  → EXIT BEFORE GRACE DEADLINE
```

## 10.2 Concurrency

Worker concurrency MUST be bounded by the scarcest material resource or an explicitly chosen safety limit—not only by CPU count.

Consider:

- DB pool;
- provider quota;
- memory per job;
- network sockets;
- downstream concurrency;
- tenant fairness;
- per-key serialization;
- expensive model/GPU capacity;
- external financial/API rate limits.

## 10.3 Batch processing

If workers batch:

- bound batch size and memory;
- define partial-batch failure semantics;
- preserve item-level identity if retry needs it;
- avoid acknowledging unprocessed items because one batch member succeeded;
- verify ordering assumptions;
- make cancellation/backpressure visible.

## 10.4 Worker autoscaling

Do not scale from queue depth alone. Use the workload’s actual capacity model, such as:

- arrival rate;
- completion/service rate;
- oldest-work age/lag;
- processing-time percentiles;
- in-flight count;
- downstream saturation;
- retry rate;
- tenant/class backlog;
- cost/resource limits.

Scaling consumers against an already saturated dependency can amplify failure.

---

# 11. Queue and messaging standard

## 11.1 Queue adoption gate

Do not add a queue because “async scales better.” Add it when one or more requirements justify the semantics and operating cost.

| Requirement | Queue can help? | New obligations |
|---|---:|---|
| hide caller from long work | Yes | status, retry, cancellation |
| absorb short burst | Yes | queue bound/backlog policy |
| survive temporary consumer outage | Yes | retention, replay, stale work |
| fan-out | Yes | independent subscriber semantics |
| decouple deployments | Sometimes | schema compatibility/versioning |
| guarantee exactly-once business effect | Not by itself | idempotency/atomicity/reconciliation |
| solve sustained insufficient capacity | No | add capacity/admission/shedding |

## 11.2 Delivery semantics

Document the provider’s real contract:

```yaml
delivery:
  at_most_once | at_least_once | scoped_exactly_once | other
ordering:
ack_or_commit_semantics:
visibility_or_lease:
redelivery_conditions:
retention:
max_delivery_attempts:
dead_letter_behavior:
producer_deduplication:
consumer_deduplication:
```

Amazon SQS standard queues document at-least-once and possible out-of-order delivery [S15]. Google Pub/Sub defaults to at-least-once and documents scoped exactly-once behavior with important regional/subscription constraints [S17][S18].

## 11.3 Exactly-once proof obligation

An end-to-end exactly-once claim MUST identify:

1. what identity defines “same operation”;
2. whether publisher retry can create new identities;
3. broker guarantee scope;
4. consumer acknowledgement semantics;
5. consumer crash windows;
6. durable state commit semantics;
7. external side effects;
8. multi-region behavior;
9. replay/manual repair behavior.

If any boundary can duplicate the business effect, the end-to-end system is not exactly once.

## 11.4 Queue overload

Observe at least, where applicable:

- ready depth;
- in-flight depth;
- oldest-message age/lag;
- arrival rate;
- completion rate;
- retry/redelivery rate;
- processing latency distribution;
- poison/quarantine rate;
- tenant/class distribution;
- downstream saturation.

Queueing can absorb bounded bursts; it cannot eliminate a sustained arrival rate above service rate [BASE02][S02].

## 11.5 Backpressure

Backpressure may be expressed through:

- producer rate limits;
- admission rejection;
- bounded enqueue;
- slow/blocked publish;
- token/quota budget;
- queue partition quota;
- priority/fairness policy;
- reduced optional work.

Backpressure MUST reach the actor capable of reducing demand; hidden backlog is delayed failure, not backpressure.

## 11.6 Priority

Priority work SHOULD use explicit classes/queues or a scheduler that prevents starvation. A single unbounded priority queue can starve lower classes indefinitely; define aging/fairness where that is unacceptable.

---

# 12. Scheduling standard

## 12.1 Schedule contract

```yaml
schedule_id:
schedule_version:
tenant_scope:
trigger_type: cron | interval | calendar | delayed | event_time | other
timezone:
calendar_semantics:
occurrence_id_rule:
start_at:
end_at:
misfire_policy: skip | run_once | bounded_catch_up | custom
max_catch_up:
max_lateness:
overlap_policy: allow | forbid | replace | serialize_by_key
execution_deadline:
job_or_engine_type:
idempotency_scope:
suspend_behavior:
owner:
```

## 12.2 Occurrence identity

Derive a stable occurrence identity from the schedule and intended occurrence, not from the actual process start time.

Example conceptual key:

```text
schedule_id + schedule_version + intended_fire_time + tenant_scope
```

This allows duplicate triggers to converge on the same work intent.

## 12.3 Misfire and catch-up

If the scheduler is down for one hour, what happens to 60 one-minute occurrences?

Valid answers include:

- skip all stale occurrences;
- run one consolidation occurrence;
- replay up to N occurrences;
- replay every occurrence but under bounded admission/priority;
- domain-specific reconstruction.

“Whatever cron does” is not an acceptable business rule for material work.

## 12.4 Overlap

If one run exceeds its interval, explicitly choose:

- allow concurrent runs;
- reject/skip the new run;
- cancel/replace the old run if cancellation is safe;
- serialize by tenant/resource/key;
- merge work.

Kubernetes CronJob exposes analogous `Allow`, `Forbid`, and `Replace` policies and documents missed/duplicate scheduling as real behavior [S06].

## 12.5 Timezones and DST

Every human-calendar schedule MUST state timezone. Define behavior for ambiguous/repeated and skipped local times around daylight-saving transitions where relevant.

Use UTC for machine coordination when human calendar semantics do not require a local timezone; do not blindly convert human business schedules to UTC if “09:00 local business time” is the actual requirement.

---

# 13. Engine engineering standard

## 13.1 Definition

An **engine** in this playbook is a backend execution component that applies a material set of domain/technical rules over input and produces state/output, often with long-running, multi-step, compute-heavy, or reusable execution semantics.

Examples:

- transformation engine;
- pricing/rules engine;
- document-processing engine;
- reconciliation engine;
- orchestration engine;
- scoring/decision engine;
- workflow runtime;
- AI-backed engine, with additional AI playbook overlays.

An engine MAY be an in-process library, a worker type, a service, or a durable workflow runtime. “Engine” does not imply microservice.

## 13.2 Engine execution contract

```yaml
engine_id:
engine_version:
execution_id:
tenant_scope:
requested_by:
input_schema_version:
input_provenance:
data_classification:
determinism_class:
state_machine:
side_effect_class:
resource_budget:
concurrency_policy:
deadline:
cancellation:
checkpointing:
resume_semantics:
retry_semantics:
output_schema_version:
output_provenance:
compatibility_policy:
observability:
repair_or_reconciliation:
owner:
```

## 13.3 Durable execution state

For material long-running work, the durable state SHOULD make it possible to answer:

- What execution is this?
- Which version of the engine is governing it?
- What inputs were accepted?
- Which step/state is authoritative?
- Which side effects have committed?
- What may safely be retried?
- What is awaiting external input?
- Can it resume after process/deploy failure?
- Can it be cancelled?
- What requires compensation or human resolution?

## 13.4 Deployment/version compatibility

Long-running execution can outlive a deployment. Pick an explicit strategy:

- continue old semantics until completion;
- version-routed workers;
- compatible state-machine evolution;
- migration of execution state with verification;
- restart/recompute only if safe and affordable.

Do not deploy incompatible workflow code and hope existing executions adapt.

## 13.5 Checkpoints

Checkpoint only when the saved state is meaningful and verifiably resumable. A checkpoint that omits committed side-effect state can increase corruption risk.

## 13.6 Engine vs durable workflow platform

Consider a durable workflow/orchestration platform when several apply:

- execution lasts minutes to months;
- timers must survive process restart;
- retries need durable policy;
- fan-out/fan-in is common;
- human approval/wait states exist;
- compensation/reconciliation is first-class;
- execution history matters;
- worker/process deployments are independent of workflow lifetime.

Do not add a workflow platform for a three-step local function purely for fashion.

---

# 14. Multi-tenancy standard

## 14.1 Tenant definition and authority

A tenant is an isolation/billing/administrative boundary, not merely a user property.

Define:

```yaml
tenant_identifier:
tenant_authority_source:
tenant_membership_model:
resource_ownership_model:
isolation_requirements:
residency_requirements:
quota_tier:
configuration_model:
credential_model:
offboarding_model:
```

## 14.2 Tenant-context rule

A request may contain a tenant selector, but the server MUST derive/validate tenant authority against authenticated identity and policy before using it to scope data or action.

Tenant context SHOULD then be propagated explicitly to:

- service calls;
- domain commands;
- data access;
- cache keys;
- jobs;
- queue/event envelopes;
- scheduler occurrences;
- engine executions;
- audit logs;
- repair tools.

## 14.3 Isolation dimensions

Tenant isolation is not only database filtering. Review:

1. authorization/object access;
2. storage/data partition;
3. cache namespace;
4. search/vector/index namespace;
5. queue/topic/work ownership;
6. scheduler state;
7. engine execution state;
8. secrets/keys;
9. files/blobs;
10. telemetry and support tooling;
11. rate/concurrency/resource use;
12. backup/restore/export/delete.

AWS SaaS guidance explicitly treats isolation as foundational while noting implementation strategy varies by domain, compliance, and architecture [S10].

## 14.4 Isolation topology

Possible component-level patterns:

- **pooled:** shared infrastructure with logical isolation;
- **partitioned/bridge:** shared system with some tenant/group partitioning;
- **stamp/cell:** tenant groups assigned to independent deployment units;
- **silo:** dedicated resources for a tenant;
- **hybrid/tiered:** different isolation by tenant tier or component.

Microsoft’s multitenant architecture guidance emphasizes trade-offs among isolation, scale, cost, performance, complexity, and manageability rather than one universal model [S11].

## 14.5 Noisy-neighbor protection

Where tenants share resources, define:

- request rate quota;
- concurrent work quota;
- queue backlog/work budget;
- storage/data-size limits where material;
- expensive query/work-unit bounds;
- provider/API spend limits;
- scheduler fairness;
- engine compute limits;
- burst policy;
- tier behavior;
- overload response.

Fairness may allow unused capacity to be borrowed while enforcing boundaries during saturation; the exact mechanism is contextual [S05].

## 14.6 Tenant lifecycle

Automate and audit material lifecycle transitions:

```text
PROVISION
→ CONFIGURE
→ ACTIVATE
→ CHANGE TIER/CAPABILITY
→ REGION/SHARD/STAMP MOVE (if applicable)
→ SUSPEND
→ EXPORT
→ DELETE / RETAIN PER POLICY
→ REVOKE CREDENTIALS
→ VERIFY CLOSURE
```

Microsoft’s checklist recommends automating tenant onboarding, provisioning, deployment, and configuration and monitoring both overall and tenant health [S11].

## 14.7 Tenant variation

Avoid:

```text
if customer_name == "BigCustomer": special_behavior()
```

Prefer explicit, versioned:

- entitlement/capability;
- tier;
- policy;
- configuration;
- feature release cohort;
- isolation class.

Tenant variation MUST remain testable and discoverable.

---

# 15. Overload, fairness, backpressure, and admission control

## 15.1 Core rule

If demand can exceed capacity, overload behavior is part of functional correctness.

## 15.2 Admission before exhaustion

Prefer rejecting/delaying work before it consumes the scarce resource that is already saturated.

Control candidates:

- request rate limits;
- concurrency limit;
- per-tenant token bucket/quota;
- work-unit budget;
- queue capacity/age threshold;
- priority class;
- dependency-specific semaphore;
- circuit break/load shed;
- pre-computation/input bounds.

## 15.3 Retry amplification

A request retried at N independent layers multiplies attempts. Define one intentional retry ownership per dependency path or a shared budget across layers.

Google SRE explicitly recommends limiting retries, avoiding multi-layer retry multiplication, and distinguishing retryable from permanent errors [S02].

## 15.4 Latency-driven overload

Remember:

```text
in-flight concurrency ≈ arrival rate × service time
```

Even stable request rate can exhaust the system if a dependency slows materially. Dependency isolation and concurrency limits protect unrelated work [S04].

## 15.5 Graceful degradation

Allowed degradation may include:

- omit optional enrichment;
- serve acceptable cached/stale reads;
- defer best-effort work;
- disable expensive secondary features;
- switch to read-only/manual mode.

MUST NOT silently degrade:

- tenant isolation;
- authentication/authorization;
- financial/state integrity;
- privacy protection;
- safety constraints.

---

# 16. Dependency engineering

For each material dependency define:

```yaml
dependency:
owner_or_vendor:
purpose:
criticality:
request_deadline:
retry_owner:
retry_semantics:
rate_quota:
concurrency_budget:
consistency_or_freshness:
failure_mode:
degraded_mode:
security_identity:
data_shared:
observability:
exit_or_substitution:
```

A managed service moves operational tasks; it does not transfer responsibility for your user outcome.

---

# 17. Backend runtime lifecycle

## 17.1 Startup

At startup:

1. load and validate required configuration;
2. establish process identity/version;
3. initialize required local resources;
4. connect/lazily prepare dependencies according to policy;
5. start telemetry;
6. run startup checks/migrations only under controlled ownership;
7. become ready only when safe to accept the relevant work.

Do not run fleet-wide destructive migration independently from every replica startup unless the migration mechanism itself coordinates safely.

## 17.2 Health model

**Startup:** has this process initialized enough to evaluate normal health?  
**Readiness:** should new traffic/work be sent here?  
**Liveness:** is this process locally irrecoverably stuck such that restart is the intended remediation?

Kubernetes documents these as separate concepts and warns that bad liveness checks can cause cascading failure [S08].

## 17.3 Readiness

Readiness MAY depend on a critical dependency if serving without it would be incorrect, but avoid making every replica simultaneously unready because one shared optional dependency is unhealthy if doing so worsens the outage.

## 17.4 Liveness

Liveness SHOULD be shallow and local enough that restart is likely to improve the condition. Do not turn a shared database outage into a restart storm by making database reachability the only liveness criterion.

## 17.5 Shutdown and drain

Preferred sequence:

```text
MARK NOT READY / STOP ROUTING
→ STOP CLAIMING NEW WORK
→ DRAIN IN-FLIGHT WITH DEADLINE
→ CHECKPOINT / RELEASE LEASES WHERE SAFE
→ FLUSH BOUNDED TELEMETRY
→ CLOSE CONNECTIONS/RESOURCES
→ EXIT
```

Kubernetes process termination and gRPC graceful shutdown both model a grace period followed by forceful termination [S07][S09].

## 17.6 Crash safety

Every critical invariant MUST survive:

- process `SIGKILL`/equivalent;
- host/node failure;
- network partition/disconnect;
- crash after side effect but before acknowledgement;
- crash during checkpoint;
- crash during deployment.

Graceful shutdown is not a transaction boundary.

---

# 18. Configuration, secrets, and runtime policy

## 18.1 Configuration contract

Production config SHOULD be:

- schema validated;
- typed where the platform permits;
- versioned/auditable;
- explicit about defaults;
- environment/tenant ownership known;
- safe to inspect without exposing secrets;
- rejected on material invalid combinations.

## 18.2 Fail-open vs fail-closed

For each material config/policy dependency, define whether absence/error should:

- fail startup;
- make instance unready;
- use last-known-good state;
- use a safe default;
- disable a feature;
- degrade to read-only;
- require operator action.

A generic “fallback default” can be dangerous for authorization, tenancy, financial limits, or data retention.

## 18.3 Hot reload

Hot reload is an execution path. Define atomicity, validation, rollback/last-known-good behavior, fleet convergence, and telemetry. If those are harder than process restart and rollout, restart may be safer.

## 18.4 Secrets and service identity

Workers/services SHOULD use scoped machine identity and short-lived credentials where platform support exists. OWASP ASVS 5.0 includes backend communication requirements for authenticated service identities and least privilege [S13].

---

# 19. Observability standard

OpenTelemetry distinguishes observability from the telemetry signals used to achieve it: logs, metrics, and traces are evidence used to answer operational questions [S12].

## 19.1 Correlation model

Where relevant, retain:

```yaml
trace_id:
request_id:
work_id:
attempt_id:
schedule_occurrence_id:
engine_execution_id:
tenant_scope:
actor_or_service_identity:
release_version:
config_or_policy_version:
```

Do not put high-cardinality/sensitive values into metric labels blindly. Logs/traces may be better for per-tenant detail.

## 19.2 Request/service signals

- request rate;
- successful/failed outcomes by meaningful category;
- latency distribution;
- saturation/concurrency;
- dependency latency/error;
- retry rate;
- cancellation/timeout;
- admission rejection/load shed;
- domain-correctness signal.

## 19.3 Job/worker signals

- work created/completed/failed;
- age-to-start;
- execution duration;
- attempts per work item;
- retry reason;
- lease expiry/lost worker;
- cancellation;
- quarantine/DLQ;
- worker concurrency/saturation;
- throughput;
- backlog age.

## 19.4 Scheduler signals

- expected occurrences;
- created occurrences;
- lateness;
- skipped/missed;
- duplicate trigger detected;
- overlap prevented/replaced;
- catch-up count;
- schedule disabled/suspended;
- execution success by occurrence.

## 19.5 Multi-tenant signals

Observe, with privacy/cardinality discipline:

- per-tenant SLO or failure where material;
- quota/throttle events;
- heavy-tenant/resource consumption;
- tenant-isolation policy violations;
- provisioning lifecycle failures;
- stamp/shard placement imbalance.

## 19.6 Engine signals

- execution state transitions;
- step latency/failure;
- checkpoint age;
- resume/recovery count;
- stuck execution age;
- external-wait age;
- cancellation outcome;
- version distribution;
- resource/cost consumption;
- output validation failures.

---

# 20. Security and privacy baseline for backend execution

This section is a minimum overlay, not a replacement for the Security and Privacy specialist standards.

## 20.1 Authentication and authorization

- Authenticate privileged backend-to-backend communication appropriate to threat model.
- Apply least privilege to service/worker/scheduler/engine identity.
- Authorize resource + action + tenant/context, not merely role name.
- Treat admin/repair/replay endpoints as high-privilege surfaces.
- Do not trust internal network origin alone.

OWASP ASVS 5.0 is the current stable ASVS version at this cutoff and provides a security verification baseline for web applications and services [S13].

## 20.2 Resource abuse

OWASP API Security guidance explicitly treats unrestricted resource consumption and sensitive business-flow automation as security/business risks [S14]. Backend design therefore SHOULD bound:

- payload/body/file size;
- result/page size;
- batch size;
- request rate;
- concurrency;
- expensive search/filter complexity where practical;
- external paid operations;
- queue/job creation;
- tenant spend/work units.

## 20.3 SSRF and outbound calls

Treat URL/host/endpoint input that can cause server-side network calls as a trust boundary. Apply allowlists/policy, DNS/IP protections, credential scope, and egress restrictions appropriate to risk.

## 20.4 Background credentials

A background worker often outlives a user request and MUST NOT simply inherit unbounded user/session credentials. Create a durable authorization model appropriate to the job:

- captured authorized intent;
- scoped system capability;
- re-authorization at execution when policy requires it;
- expiry and revocation semantics.

## 20.5 Privacy in async systems

Queue payloads, job tables, traces, retry records, engine checkpoints, DLQs, and repair logs are data stores. Apply classification, minimization, access, retention, deletion, backup, and telemetry-redaction policy.

---

# 21. Performance, capacity, and cost

## 21.1 Capacity model

For material workloads define:

- arrival rate distribution;
- work/service-time distribution;
- concurrency;
- memory/CPU/I/O per unit;
- downstream limits;
- burst tolerance;
- queue/catch-up capacity;
- tenant mix;
- scaling latency;
- cost per work unit where material.

## 21.2 Tail latency

Average latency can hide saturation. Track relevant percentiles/tails and correlate with concurrency/dependency latency.

## 21.3 Queue capacity

Test:

- normal load;
- burst;
- sustained overload;
- consumer slowdown;
- dependency outage;
- retry storm;
- recovery/catch-up after outage;
- poison workload;
- dominant tenant.

## 21.4 Cost safety

For metered third-party APIs, AI inference, messaging, egress, or compute-heavy jobs:

- assign budget/limits;
- observe per tenant/work type where material;
- prevent retry storms from multiplying spend;
- stop obsolete/stale work;
- verify that autoscaling does not simply scale cost into a failing dependency.

---

# 22. Verification and test strategy

Choose evidence by failure mode rather than ritual test ratios [BASE02].

## 22.1 Domain tests

Verify:

- invariants;
- state-machine transitions;
- permissions/business rules;
- edge values;
- conflict behavior;
- deterministic calculations;
- invalid states.

Use property-based/model/state-machine testing where the invariant/state space justifies it.

## 22.2 Service integration tests

Verify:

- real serialization/contract;
- auth/tenant context;
- database constraints/transactions;
- dependency failure mapping;
- timeout/cancellation;
- compatibility;
- observability correlation.

## 22.3 Async/job tests

Mandatory for material jobs:

- duplicate delivery;
- crash after effect before ack;
- crash before effect;
- retryable vs terminal errors;
- max-attempt behavior;
- poison/quarantine;
- replay;
- cancellation;
- lease expiry;
- stale worker vs new worker;
- concurrency limit;
- shutdown drain.

## 22.4 Queue tests

- duplicate;
- reorder where transport permits;
- retention expiry;
- backlog growth;
- consumer slowdown;
- dead-letter/quarantine;
- replay;
- schema/version mismatch;
- publisher retry;
- tenant/class starvation.

## 22.5 Scheduler tests

- exact occurrence ID;
- duplicate trigger;
- skipped trigger;
- late start;
- overlap;
- catch-up after outage;
- suspend/resume;
- DST/local-time transition where applicable;
- schedule version change while old execution is running.

## 22.6 Multi-tenant tests

- cross-tenant object ID attacks;
- missing/wrong tenant context;
- cache-key isolation;
- queue/job tenant mismatch;
- engine execution mismatch;
- support/admin access;
- tenant offboarding/deletion;
- dominant-tenant load/noisy neighbor;
- quota bypass;
- restore/export isolation.

AWS SaaS guidance calls tenant isolation testing essential, and Azure guidance emphasizes noisy-neighbor testing/controls [S10][S11].

## 22.7 Runtime failure tests

- process kill;
- rolling restart;
- dependency slowdown;
- dependency fast failure;
- DNS/network disruption where relevant;
- DB pool exhaustion;
- memory/resource pressure;
- readiness loss;
- invalid config;
- telemetry backend failure;
- forced shutdown after grace period.

## 22.8 Engine tests

- resume from every durable checkpoint;
- old execution across new deployment;
- cancellation at each material step;
- repeated step execution;
- output schema validation;
- partial side effect;
- stuck-state detector;
- reconciliation;
- resource-budget breach;
- nondeterministic input provenance.

---

# 23. Release, migration, and change safety

## 23.1 Backward compatibility window

During rolling deployment, assume old and new backend versions can coexist unless deployment proves otherwise.

Verify compatibility for:

- DB/schema;
- queue/event schema;
- job payload;
- engine execution state;
- cache keys;
- service contracts;
- schedule contract;
- configuration;
- feature/tier policy.

## 23.2 Job/event schema evolution

Durable queued work can outlive code. Do not remove readers for old payloads while old work still exists unless you migrate/purge it safely.

Use:

- versioned payload;
- backward-compatible reader;
- migration/rewrite with audit;
- queue drain before breaking change;
- expiry bounded enough to justify dropping support.

## 23.3 Long-running engine migration

A deploy MUST define behavior for in-flight executions. “New code picks up old state” is a compatibility claim and requires test evidence.

## 23.4 Rollback

Rollback is unsafe if the new release has already produced state or side effects the old release cannot interpret. Choose rollback vs roll-forward from actual state compatibility [BASE02].

---

# 24. Operations, repair, replay, and reconciliation

## 24.1 Repair is a first-class capability

Production state can become ambiguous or incorrect despite prevention. High-quality backends include controlled tools/processes to:

- inspect authoritative state;
- identify affected scope;
- dry-run proposed repair;
- apply bounded mutation;
- audit actor/reason/change;
- verify postconditions;
- reverse or compensate when feasible.

## 24.2 Reconciliation

Use reconciliation when desired state can be compared to actual state and drift repaired safely.

Typical uses:

- external payment/provider state;
- incomplete provisioning;
- outbox dispatch;
- missing derived data/indexes;
- stale engine executions;
- migration/backfill consistency;
- tenant resource inventory.

## 24.3 Replay

A replay MUST answer:

```yaml
source_range_or_ids:
why_replay_is_needed:
code_version:
idempotency_proof:
side_effect_risk:
tenant_scope:
rate_limit:
stop_condition:
monitoring:
approver:
post_reconciliation:
```

Do not bulk-replay a DLQ blindly.

## 24.4 Administrative endpoints

Admin/repair paths SHOULD be separated from ordinary user paths by stronger authorization, audit, rate/scope controls, and possibly a separate control plane.

---

# 25. Decision frameworks

## 25.1 Modular monolith or services?

```text
Does a network/process boundary buy independent scaling, deployment,
security, failure isolation, or ownership that materially matters?
  ├─ NO → keep a strong internal module
  └─ YES → can the need be met by process-local/resource isolation?
             ├─ YES → prefer simpler topology
             └─ NO  → extract the service and pay distributed costs explicitly
```

## 25.2 Inline request or background job?

Use inline when:

- caller needs the result now;
- work is bounded and predictably within deadline;
- dependency/retry semantics fit request lifecycle.

Use background when:

- work is long-running;
- caller need not block;
- durable retry/recovery matters;
- work can be throttled/buffered independently;
- resource isolation is valuable.

Async is not automatically faster; it moves latency and creates state.

## 25.3 Queue or durable database job table?

A database-backed job table can be adequate when:

- scale is moderate;
- one data store already owns the transactional intent;
- simple claim/lease/retry semantics are sufficient;
- operational simplicity dominates.

A broker/queue becomes more valuable when:

- high throughput/fan-out;
- independent retention/replay;
- specialized ordering/partitioning;
- cross-service decoupling;
- broker-specific flow control;
- workload isolation/operations justify it.

Neither choice removes idempotency and recovery obligations.

## 25.4 Cron or durable scheduler/workflow?

Use simple cron when:

- missed/duplicate execution is harmless/idempotent;
- schedule count is small/moderate;
- no durable per-occurrence workflow state is needed.

Use durable scheduling/workflow when:

- per-tenant dynamic schedules are numerous;
- misfire/catch-up/overlap semantics are material;
- long-lived timers/waits exist;
- execution history/retry/cancellation must survive restarts/deploys.

## 25.5 Pooled or siloed tenant resources?

Choose based on:

- isolation consequence;
- compliance/residency;
- noisy-neighbor risk;
- cost efficiency;
- tenant count/growth;
- automation maturity;
- per-tenant customization need;
- operational fleet complexity.

Do not assume maximum physical isolation is automatically best or that pooled resources are automatically safe [S10][S11].

## 25.6 Shared worker pool or isolated pools?

Share when workloads have compatible:

- priority;
- latency;
- resource profile;
- dependency set;
- failure consequence.

Split/bulkhead when one class can starve, block, exhaust, or delay a more important class.

## 25.7 Retry or reconcile?

Retry when failure is transient and effect is safe/repeatable.  
Reconcile when outcome is unknown, state can be inspected, or repeated side effects are unsafe.  
Escalate/manual resolution when neither automatic retry nor deterministic reconciliation can prove safety.

## 25.8 Distributed lock or ownership partition?

Prefer durable ownership/partitioning/state-machine semantics when possible. Use distributed locks when mutual exclusion is truly required, and add lease expiry + fencing/version controls if stale owners can continue after losing the lease.

---

# 26. Anti-pattern catalog

## 26.1 “Microservices are production grade”
**Reject.** Service boundaries add failure/operational cost. Use only when they buy a material property [BASE02].

## 26.2 “Just put a queue in front”
**Reject.** A queue absorbs finite bursts but can accumulate an unrecoverable backlog if service rate remains below arrival rate [S02].

## 26.3 “The queue is exactly once”
**Reject as an end-to-end claim.** Broker guarantees have scope; producer duplicates, consumer crash windows, and external side effects still matter [S15][S17].

## 26.4 “Retry every failure”
**Reject.** Permanent errors waste capacity; retries amplify overload and side effects [S01][S02][S03].

## 26.5 “Exponential backoff makes retries safe”
**Reject.** Backoff addresses timing; idempotency, budgets, overload state, and side-effect semantics remain.

## 26.6 “A DLQ means failure is handled”
**Reject.** A DLQ can become silent data loss without ownership/repair/replay.

## 26.7 “Cron runs once at the configured time”
**Reject.** Real schedulers can create duplicate/missed/late runs; make execution idempotent and define policy [S06].

## 26.8 “One scheduler replica prevents duplicates”
**Reject.** Process loss/failover/manual invocation/deploy overlap can still duplicate; correctness belongs in durable occurrence/execution semantics.

## 26.9 “Graceful shutdown prevents partial work”
**Reject.** Forceful death remains possible [S07].

## 26.10 “Health endpoint should check every dependency”
**Reject as a universal rule.** A shared dependency outage can turn deep liveness into restart cascade; readiness and liveness serve different purposes [S08].

## 26.11 “Internal services trust each other”
**Reject.** Internal hops can carry compromised or mis-scoped identity; authenticate/authorize material backend communication [S13].

## 26.12 “Tenant_id in the request scopes the query”
**Reject.** Tenant selection must be authorized against trusted identity/context.

## 26.13 “One tenant cannot hurt another if data is filtered”
**Reject.** Resource starvation/noisy-neighbor failure is also a tenancy isolation concern [S05][S11].

## 26.14 “Separate database per tenant is always safest”
**Reject as universal.** It improves some isolation properties but increases cost/fleet/operational complexity; choose topology by requirements [S11].

## 26.15 “Controllers must always be thin”
**Heuristic only.** The real rule is that domain authority/invariants should have a canonical home; arbitrary line-count thinness is irrelevant.

## 26.16 “Repository pattern is best practice”
**Implementation choice.** Use it when it hides a volatile persistence boundary; avoid one-to-one proxy layers with no information hiding.

## 26.17 “CQRS/event sourcing scales better”
**Implementation choice.** They can solve divergent read/write/audit requirements but add projection, ordering, versioning, privacy deletion, and mental complexity.

## 26.18 “A distributed lock makes a singleton safe”
**Reject.** Lease expiry/stale owners/failure to fence can create concurrent writers.

## 26.19 “Autoscale workers on queue depth”
**Incomplete.** Depth omits work cost, age, downstream capacity, retries, and arrival/service rates.

## 26.20 “More workers always drain backlog faster”
**Reject.** More consumers can overload the shared dependency and reduce throughput.

## 26.21 “The background job can reuse the user session token”
**Reject by default.** Long-lived async execution needs explicit durable authorization semantics and scoped identity.

## 26.22 “Business logic in ORM hooks guarantees consistency”
**Reject as a general architecture.** Hidden lifecycle callbacks can make domain policy non-local and difficult to reason about/replay; use only with explicit ownership and tests.

## 26.23 “Engine progress equals committed business state”
**Reject.** Track progress/checkpoints separately from irreversible external effects.

## 26.24 “A green worker means the queue is healthy”
**Reject.** Observe age, throughput, retries, backlog composition, and downstream saturation.

## 26.25 “Tenant-specific code is faster than a configuration model”
**Reject as sustained design.** Invisible customer forks create drift; represent variation as explicit capabilities/policy/configuration where feasible [S11].

---

# 27. Canonical engineering templates

## 27.1 Service contract

```yaml
service_or_module:
owner:
responsibility:
authoritative_state:
callers:
dependencies:
trust_boundaries:
contracts:
  success:
  failures:
  timeout:
  cancellation:
  retryability:
  compatibility:
resource_budgets:
  concurrency:
  rate:
  payload:
  dependency_limits:
tenancy:
security_identity:
observability:
degraded_mode:
recovery:
review_triggers:
```

## 27.2 Job contract

```yaml
job_type:
work_id_rule:
attempt_id_rule:
tenant_scope:
idempotency_scope:
business_effect_key:
input_schema:
output_schema:
priority:
deadline:
max_attempt_runtime:
max_attempts:
max_retry_elapsed:
backoff:
concurrency:
lease_heartbeat:
cancellation:
side_effects:
ack_commit_rule:
terminal_failure:
quarantine:
replay:
owner:
telemetry:
```

## 27.3 Queue contract

```yaml
queue_or_subscription:
purpose:
producer_owners:
consumer_owners:
delivery_semantics:
ordering_scope:
message_identity:
schema_versioning:
ack_visibility_lease:
retry:
redelivery:
retention:
expiry:
dead_letter:
replay:
backpressure:
capacity_and_limits:
priority_fairness:
tenant_isolation:
observability:
```

## 27.4 Schedule contract

```yaml
schedule:
owner:
tenant_scope:
timezone:
calendar_semantics:
occurrence_id:
misfire_policy:
max_lateness:
catch_up_policy:
overlap_policy:
execution_deadline:
execution_target:
idempotency:
suspension:
change_versioning:
observability:
```

## 27.5 Engine execution contract

```yaml
engine:
engine_version:
execution_id:
tenant_scope:
input_schema_version:
input_provenance:
state_machine:
determinism:
side_effects:
resource_budget:
checkpoint:
resume:
retry:
cancellation:
output_schema_version:
compatibility:
repair_reconcile:
audit:
owner:
```

## 27.6 Multi-tenant isolation contract

```yaml
tenant_definition:
trusted_tenant_resolution:
resource_scope:
authorization_invariant:
data_isolation:
cache_isolation:
queue_job_isolation:
engine_isolation:
secret_key_isolation:
telemetry_isolation:
quota_fairness:
noisy_neighbor_controls:
residency:
tenant_lifecycle:
offboarding_delete_export:
admin_support_access:
isolation_tests:
```

---

# 28. Production readiness gate

A production backend SHOULD NOT pass release readiness with an unresolved applicable BLOCKER below.

## 28.1 Intent and ownership

- [ ] Critical user/business outcomes identified.
- [ ] State/domain owners named.
- [ ] Runtime/on-call owner named where required.
- [ ] Criticality/rigor classified.

## 28.2 State and domain correctness

- [ ] Material invariants explicit.
- [ ] Mutation/transaction boundaries defined.
- [ ] Concurrency/conflict semantics defined.
- [ ] Unknown partial outcomes have reconciliation/escalation.
- [ ] No hidden duplicate sources of authoritative business rules.

## 28.3 Services and dependencies

- [ ] Service boundaries justified by requirements.
- [ ] Deadlines/timeouts defined.
- [ ] Retry owner/budget defined.
- [ ] Cancellation propagation appropriate.
- [ ] Slow dependency blast radius contained where material.

## 28.4 Jobs/workers

- [ ] Work identity ≠ attempt identity.
- [ ] Idempotency/dedup effect defined.
- [ ] Worker concurrency bounded.
- [ ] Crash-after-effect/before-ack tested.
- [ ] Lease/stale-worker behavior safe.
- [ ] Poison/quarantine path owned.
- [ ] Shutdown drain tested.

## 28.5 Queue/messaging

- [ ] Delivery/order semantics verified against actual provider.
- [ ] Retention/expiry known.
- [ ] Backlog/overload policy exists.
- [ ] Replay controls exist.
- [ ] Queue age + throughput + retries observed.
- [ ] “Exactly once” claims scoped/proven.

## 28.6 Scheduling

- [ ] Timezone explicit.
- [ ] Occurrence identity explicit.
- [ ] Missed/late/catch-up policy defined.
- [ ] Overlap policy defined.
- [ ] Duplicate/missed trigger test passed.

## 28.7 Engines

- [ ] Execution state durable where material.
- [ ] Engine/state version compatibility tested.
- [ ] Checkpoint/resume verified if required.
- [ ] Cancellation semantics tested.
- [ ] Side effects separated/reconciled.

## 28.8 Multi-tenancy

- [ ] Trusted tenant resolution enforced.
- [ ] Cross-tenant authorization tests passed.
- [ ] Cache/queue/job/engine tenant scope tested.
- [ ] Noisy-neighbor controls validated.
- [ ] Tenant lifecycle automated/audited where material.
- [ ] Offboarding/delete/export semantics defined.

## 28.9 Runtime lifecycle

- [ ] Startup config validation.
- [ ] Readiness meaningful.
- [ ] Liveness safe.
- [ ] Graceful drain tested.
- [ ] Force kill tested.
- [ ] Resource limits/bounds configured.

## 28.10 Security/privacy

- [ ] Service/worker identities least-privilege.
- [ ] Repair/admin paths protected/audited.
- [ ] Resource abuse limits present.
- [ ] Async stores/logs/queues reviewed for sensitive data.
- [ ] Secrets excluded from telemetry.

## 28.11 Observability/operations

- [ ] Correlation IDs for relevant execution layers.
- [ ] User/domain correctness signals present.
- [ ] Queue/scheduler/job/engine failure states visible.
- [ ] Alerts actionable.
- [ ] Repair/replay runbook exists where needed.
- [ ] Release version/config correlation exists.

## 28.12 Verification and recovery

- [ ] Duplicate/reorder/retry paths tested.
- [ ] Dependency slowdown and overload tested.
- [ ] Recovery/restore/repair path tested.
- [ ] Rolling-version compatibility tested.
- [ ] Stop/rollback/roll-forward path defined.

---

# 29. Audit standard for an existing backend

Use this order; do not begin with code style.

## 29.1 Authority audit

- What owns each material business fact?
- Where can it be mutated?
- Which invariants are only tribal knowledge?
- Can two paths implement different versions of the same rule?

## 29.2 Failure audit

For each dependency/workflow:

- slow?
- unavailable?
- timeout?
- duplicate?
- reorder?
- partial success?
- crash?
- overload?
- stale data?
- cancellation?

## 29.3 Work-bound audit

- Is request concurrency bounded?
- Is worker concurrency bounded?
- Is queue/backlog growth bounded or controlled?
- Are retries bounded?
- Are payload/batch/work units bounded?

## 29.4 Async audit

- Do work and attempts have distinct identities?
- Are effects idempotent/reconcilable?
- Is ack after durable outcome?
- Is DLQ owned?
- Can replay do harm?

## 29.5 Scheduler audit

- timezone?
- overlap?
- missed run?
- catch-up?
- duplicate fire?
- deadline/lateness?

## 29.6 Multi-tenant audit

- Can a caller switch tenant by changing an ID?
- Are cache/job/queue/engine keys tenant-scoped?
- Can one tenant saturate a shared dependency?
- Can admin/support tooling cross tenants silently?
- Can deletion/export accidentally span tenants?

## 29.7 Runtime audit

- config validation?
- readiness/liveness distinction?
- graceful drain?
- crash safety?
- DB/provider pool limits?
- dependency isolation?

## 29.8 Observability audit

Can an operator answer within minutes:

- which user/tenant/work type is failing?;
- which dependency or release correlates?;
- is queue age growing because arrival rose or workers slowed?;
- are retries amplifying load?;
- are jobs duplicated?;
- are schedule occurrences missing?;
- which engine executions are stuck?;
- what repair is safe?

## 29.9 Change audit

- Can old/new versions coexist?
- Can old queued work still be read?
- Can old engine state resume?
- Is rollback state-compatible?
- Is config/policy versioned?

---

# 30. One-page Backend Golden Standard

1. **Define authoritative behavior and unacceptable failure before topology.**
2. **Give every material fact, mutation, side effect, and runtime responsibility an owner.**
3. **Prefer the least distributed architecture that meets real scaling/deployment/isolation/ownership needs.**
4. **Keep domain invariants canonical and explicit; do not let framework callbacks become accidental business authority.**
5. **Define transaction and external-side-effect boundaries honestly.**
6. **Treat remote dependencies as slow, unavailable, duplicated, stale, or wrong.**
7. **Use finite deadlines/cancellation and one bounded retry strategy.**
8. **Retry only transient work safe to repeat; backoff is not idempotency.**
9. **Separate stable work identity from execution attempts.**
10. **Assume workers can die after the side effect and before acknowledgement.**
11. **Acknowledge only after the required durable outcome is established.**
12. **Bound worker/request concurrency and all resource pools that can saturate.**
13. **A queue absorbs finite bursts; it does not create capacity.**
14. **Treat duplicate and out-of-order delivery as normal unless stronger guarantees are proven.**
15. **Treat exactly-once as a scoped proof obligation, not a slogan.**
16. **Make poison work terminal and owned; a DLQ is not closure.**
17. **Every schedule defines timezone, occurrence ID, overlap, lateness, misfire, and catch-up policy.**
18. **Scheduled work is idempotent; correctness never assumes one perfect cron fire.**
19. **Long-running engines have durable execution identity/state/version and explicit resume/cancel semantics.**
20. **Do not keep the only material engine/workflow state in process memory.**
21. **Tenant isolation applies to authorization, data, caches, jobs, queues, engines, secrets, telemetry, and resource use.**
22. **A tenant ID is a selector, not authorization.**
23. **Protect shared capacity from noisy neighbors with quotas/fairness/isolation.**
24. **Model tenant variation as explicit policy/configuration, not hidden customer forks.**
25. **Separate startup, readiness, and liveness; a bad health check can become an outage mechanism.**
26. **Stop intake before drain; but make correctness survive abrupt kill.**
27. **Observe domain outcomes, retries, queue age, saturation, scheduler lateness, engine state, and tenant impact—not only CPU/uptime.**
28. **Make repair, replay, and reconciliation controlled, auditable production capabilities.**
29. **Test duplicate, crash, timeout, slowdown, overload, catch-up, cross-tenant access, and rolling-version coexistence.**
30. **Every material release has a credible stop/contain/rollback/roll-forward path consistent with state evolution.**

---

# 31. Evidence map

The source classes below follow the inherited principle that authority must fit the claim. Provider docs establish provider semantics; operational sources demonstrate mechanisms; they do not create universal technology mandates.

| ID | Source | Evidence role | Used for | Important limitation |
|---|---|---|---|---|
| BASE01 | Master Playbook Standard v2.0-RC1, uploaded | House meta-standard + broad evidence synthesis | playbook structure, risk/rigor, traceability, automation controls | not a backend implementation manual |
| BASE02 | Universal Software & AI Engineering Master Playbook v2.0, uploaded | Root engineering standard | state, boundaries, failure, retries, queues, observability, service decisions | specialist implementation depth intentionally delegated |
| S01 | IETF RFC 9110 — HTTP Semantics | Internet standard/protocol semantics | idempotent methods and automatic retry caution | HTTP method semantics do not prove business idempotency |
| S02 | Google SRE — Addressing Cascading Failures / Handling Overload | mature production operational evidence | retry budgets, amplification, overload, load shedding | Google-scale details require contextual adaptation |
| S03 | Amazon Builders’ Library — Timeouts, Retries, and Backoff with Jitter; Making Retries Safe with Idempotent APIs | mature production operational evidence | safe retry, jitter, idempotency | Amazon implementation patterns are not universal mandates |
| S04 | Amazon Builders’ Library — Using dependency isolation to contain concurrency overload | mature production operational evidence | latency-driven concurrency, bulkheads/dependency isolation | exact isolation mechanism is workload-dependent |
| S05 | Amazon Builders’ Library — Fairness in multi-tenant systems | mature production operational evidence | quotas, admission control, fairness | service scale/algorithms are contextual |
| S06 | Kubernetes — CronJob | official platform semantics | duplicate/missed scheduling, overlap, deadline, timezone, idempotent jobs | Kubernetes-specific scheduler; generalized only at failure-semantics level |
| S07 | Kubernetes — Pod Lifecycle | official platform semantics | graceful termination and forceful kill | container-orchestrator context |
| S08 | Kubernetes — Liveness, Readiness and Startup Probes | official platform semantics/operational guidance | health-mode separation, liveness cascade warning | probe mechanism is Kubernetes-specific |
| S09 | gRPC — Graceful Shutdown | official protocol/runtime guidance | stop new work, drain in-flight to deadline | gRPC-specific mechanism; principle generalizes |
| S10 | AWS Well-Architected SaaS Lens — Tenant Isolation / Foundations | mature vendor architecture guidance | tenant isolation, noisy neighbor, isolation topology | AWS implementation context |
| S11 | Microsoft Azure Architecture Center — Multitenant architecture/checklist | mature vendor architecture guidance | topology trade-offs, noisy neighbor, tenant lifecycle automation | Azure examples are provider-specific |
| S12 | OpenTelemetry — Observability Primer | open ecosystem specification/guidance | observability vs telemetry | instrumentation does not guarantee useful observability |
| S13 | OWASP ASVS 5.0.0 | open application-security verification standard | backend communication auth/least privilege, security baseline | application-focused; threat model may require more |
| S14 | OWASP API Security Top 10 2023 | security risk-awareness guidance | resource consumption, authorization/business-flow abuse | awareness list, not complete verification standard |
| S15 | Amazon SQS — at-least-once delivery | official platform semantics | duplicate delivery/idempotent consumers | SQS-specific |
| S16 | Google Cloud Tasks — issues/limitations + overview | official platform semantics | guaranteed execution can produce duplicates; idempotent handlers | Cloud Tasks-specific |
| S17 | Google Cloud Pub/Sub — exactly-once delivery | official platform semantics | exactly-once scope/limitations | Pub/Sub-specific |
| S18 | Google Cloud Pub/Sub — subscription overview/best practices | official platform semantics | default at-least-once, redelivery, flow control | Pub/Sub-specific |

---

# 32. Source register

## BASE01 — Master Playbook Standard v2.0-RC1
**Source:** uploaded `master_playbook_standard_v2.0.md`  
**Used for:** operational-playbook architecture, evidence discipline, risk-proportionate rigor, automation control, traceability, validation status.  
**Key inherited rule:** production systems are normally controlled-rigor work and automation increases the control bar.

## BASE02 — Universal Software & AI Engineering Master Playbook v2.0
**Source:** uploaded `universal_software_ai_engineering_master_playbook_v2.md`  
**Used for:** explicit state/authority/ordering, bounded work, retry budgets, idempotency, service-boundary decisions, queues, observability, production readiness.

## S01 — RFC 9110: HTTP Semantics
**Institution:** IETF / RFC Editor  
**URL:** https://www.rfc-editor.org/rfc/rfc9110.html  
**Finding:** idempotent methods may be automatically retried after communication failure; clients should not automatically retry non-idempotent requests unless they know repetition is safe or the original request was not applied.

## S02 — Google SRE: Addressing Cascading Failures / Handling Overload
**Institution:** Google  
**URLs:**  
- https://sre.google/sre-book/addressing-cascading-failures/  
- https://sre.google/sre-book/handling-overload/  
**Finding:** overload, retry multiplication, synchronized retries, queues, and latency can create positive feedback/cascading failure; bound retries and shed/backpressure work.

## S03 — Amazon Builders’ Library: retries and idempotency
**Institution:** Amazon Web Services  
**URLs:**  
- https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/  
- https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/  
**Finding:** retries consume server resources; side-effecting operations need idempotency to be safely retried; jitter/backoff mitigate synchronization but do not solve semantic safety.

## S04 — Amazon Builders’ Library: Using dependency isolation to contain concurrency overload
**Institution:** Amazon Web Services  
**URL:** https://builder.aws.com/content/3EuxuD6bWtQ6gEp9FaKQfd3Z2AM/using-dependency-isolation-to-contain-concurrency-overload  
**Finding:** dependency slowdown raises concurrency and can exhaust shared resources; isolate concurrency by dependency/API when blast radius warrants it.

## S05 — Amazon Builders’ Library: Fairness in multi-tenant systems
**Institution:** Amazon Web Services  
**URL:** https://builder.aws.com/content/3Eupj3d2bo4fEvlzYbICMZNhQ3B/fairness-in-multi-tenant-systems  
**Finding:** rate limits, quotas, placement/capacity monitoring, and workload isolation support predictable multi-tenant performance.

## S06 — Kubernetes CronJob
**Institution:** Kubernetes  
**URL:** https://kubernetes.io/docs/concepts/workloads/controllers/cron-jobs/  
**Status reviewed:** page current at evidence cutoff; modified May 2026.  
**Finding:** schedule creation is approximate; under some conditions two Jobs or no Job may be created; jobs should therefore be idempotent. Defines concurrency policy, missed-start deadline, suspension, and timezone.

## S07 — Kubernetes Pod Lifecycle
**Institution:** Kubernetes  
**URL:** https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/  
**Finding:** process termination uses a grace period and eventually forceful kill; applications should support graceful termination but cannot assume infinite cleanup time.

## S08 — Kubernetes Liveness/Readiness/Startup Probes
**Institution:** Kubernetes  
**URL:** https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/  
**Finding:** startup, readiness, and liveness have distinct purposes; incorrect liveness configuration can create cascading failures.

## S09 — gRPC Graceful Shutdown
**Institution:** gRPC project  
**URL:** https://grpc.io/docs/guides/server-graceful-stop/  
**Finding:** graceful server stop rejects new RPCs while allowing in-flight requests until completion or a deadline, followed by forced shutdown.

## S10 — AWS Well-Architected SaaS Lens — tenant isolation
**Institution:** Amazon Web Services  
**URLs:**  
- https://docs.aws.amazon.com/wellarchitected/latest/saas-lens/tenant-isolation.html  
- https://docs.aws.amazon.com/wellarchitected/latest/saas-lens/foundations.html  
**Finding:** tenant isolation is foundational, strategies vary by domain/compliance/deployment, and multi-tenant load/noisy-neighbor behavior requires explicit protection and tests.

## S11 — Azure Architecture Center — multitenancy
**Institution:** Microsoft  
**URLs:**  
- https://learn.microsoft.com/en-us/azure/architecture/guide/multitenant/overview  
- https://learn.microsoft.com/en-us/azure/architecture/guide/multitenant/considerations/tenancy-models  
- https://learn.microsoft.com/en-us/azure/architecture/guide/multitenant/checklist  
**Finding:** tenancy designs trade isolation, scale, cost, performance, complexity, and manageability; guidance emphasizes noisy-neighbor controls, tenant lifecycle automation, overall/per-tenant monitoring, and avoiding hard-coded tenant behavior.

## S12 — OpenTelemetry Observability Primer
**Institution:** OpenTelemetry  
**URL:** https://opentelemetry.io/docs/concepts/observability-primer/  
**Finding:** logs, metrics, and traces are telemetry used to make a system observable and answer operational questions.

## S13 — OWASP Application Security Verification Standard 5.0.0
**Institution:** OWASP  
**URL:** https://owasp.org/projects/asvs  
**Status:** latest stable version identified by OWASP at evidence cutoff.  
**Finding:** security verification baseline for web apps/services; includes authenticated, least-privilege backend communication requirements.

## S14 — OWASP API Security Top 10 2023
**Institution:** OWASP  
**URL:** https://api-security.owasp.org/editions/2023/en/0x11-t10/  
**Finding:** highlights object/function authorization, unrestricted resource consumption, sensitive business-flow abuse, SSRF, misconfiguration, inventory, and unsafe API consumption risks.

## S15 — Amazon SQS at-least-once delivery
**Institution:** AWS  
**URL:** https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/standard-queues-at-least-once-delivery.html  
**Finding:** standard queues can redeliver messages; consumers should be idempotent.

## S16 — Google Cloud Tasks
**Institution:** Google Cloud  
**URLs:**  
- https://docs.cloud.google.com/tasks/docs/common-pitfalls  
- https://docs.cloud.google.com/tasks/docs/dual-overview  
**Finding:** duplicate execution can occur; handlers should tolerate repeated execution; queue backlogs can arise from target resource exhaustion.

## S17 — Google Pub/Sub exactly-once delivery
**Institution:** Google Cloud  
**URL:** https://docs.cloud.google.com/pubsub/docs/exactly-once-delivery  
**Finding:** exactly-once has defined subscription/region constraints and does not collapse distinct duplicate publishes into one operation.

## S18 — Google Pub/Sub subscription overview/best practices
**Institution:** Google Cloud  
**URLs:**  
- https://docs.cloud.google.com/pubsub/docs/subscription-overview  
- https://docs.cloud.google.com/pubsub/docs/subscribe-best-practices  
**Finding:** default delivery is at-least-once; redelivery/out-of-order behavior and flow-control limits must be handled by subscribers.

---

# 33. V2 audit verdict

## 33.1 Claims that are strongly retained

**HIGH confidence / strong default**

- explicit domain/state ownership;
- risk-proportionate assurance;
- least-complex justified service topology;
- deadlines and bounded retries;
- idempotency for duplicate-prone mutation;
- bounded queues/concurrency;
- explicit overload behavior;
- duplicate-tolerant async work;
- scheduler occurrence/overlap/misfire semantics;
- tenant isolation as mandatory multi-tenant invariant;
- per-tenant fairness/noisy-neighbor protection when resources are shared;
- distinct readiness/liveness/startup semantics;
- abrupt process-death safety;
- production repair/reconciliation capability;
- observability tied to questions/outcomes rather than raw telemetry volume.

## 33.2 Contextual mechanisms deliberately not universalized

- microservices;
- event sourcing;
- CQRS;
- sagas as one named implementation;
- transactional outbox/inbox;
- distributed locks;
- circuit breakers;
- service mesh;
- Kubernetes;
- one queue product;
- one workflow engine;
- one ORM/repository pattern;
- one tenant-isolation topology;
- one autoscaling algorithm;
- one test pyramid.

These may be correct implementations under the conditions described in V2, but they are not the doctrine itself.

## 33.3 Residual uncertainties / watch items

1. Provider-specific “exactly-once” and ordering capabilities continue to evolve; re-check before relying on them.
2. Runtime/orchestrator health, scheduling, and termination semantics can change by platform/version.
3. Multi-tenant fairness mechanisms are architecture/workload-specific; local load evidence is mandatory at scale.
4. AI-backed engines require the dedicated AI/LLM and Agentic AI standards in addition to this playbook.
5. Jurisdiction-specific data, security, financial, safety, or AI rules can make normally contextual controls mandatory.

## 33.4 Validation status

This V2 has completed:

- foundation alignment against the two uploaded master standards;
- external primary/official-source research;
- contradiction search;
- falsification audit;
- source-status check for material platform/security references;
- mechanical Markdown audit.

It has **not** completed representative non-author execution on a live backend system. Therefore `REVIEWED` is the correct inherited lifecycle status, not `VALIDATED`.

---

# 34. Change log

## v2.0 — 2026-09-27

- rebuilt V1 through explicit falsification audit;
- separated work identity from execution attempts;
- strengthened duplicate/unknown-outcome semantics;
- added scheduler occurrence, timezone, catch-up, overlap and lateness contracts;
- added full engine execution/version/checkpoint/cancellation standard;
- expanded multi-tenant isolation from data access to execution/resource fairness;
- added control-plane/data-plane distinction;
- added stale-owner/fencing requirement where leases can race;
- strengthened runtime startup/readiness/liveness/drain/crash model;
- converted DLQ from passive storage to owned repair state;
- expanded queue overload and worker autoscaling signals;
- added repair/replay/reconciliation as first-class production capabilities;
- added canonical contracts and production-readiness/audit gates;
- added current source register through 27 September 2026.

---

# Final doctrine

The backend should be boring in the best sense: **its authority is knowable, its work is bounded, its failures are expected, its retries are safe, its tenants cannot escape their boundaries, its long-running execution can survive process death, its operators can see what happened, and its state can be repaired without improvising against production.**

The standard does not optimize for the fewest services, the most services, the most abstraction, the least abstraction, the highest throughput, or the most sophisticated infrastructure.

It optimizes for:

> **demonstrable correctness under real execution and failure, at the lowest justified complexity for the system’s consequence and scale.**
