# 13 — API, Integration & Distributed Systems Engineering — V2.0 Golden Master

> **Evergreen standard for contracts, APIs, events, messaging, distributed state, consistency, failure, retries, idempotency, ordering, integrations, and safe evolution**

```yaml
document_id: PB-13-API-DIST
title: API, Integration & Distributed Systems Engineering
version: 2.0
release_name: Golden Master
status: REVIEWED
created: 2026-09-27
last_updated: 2026-09-27
last_reviewed: 2026-09-27
evidence_cutoff: 2026-09-27
canonical_language: English
review_cadence: 6 months + event-driven
volatility: Moderate
fast_watch_items:
  - OpenAPI
  - AsyncAPI
  - OpenTelemetry semantic conventions
  - IETF HTTPAPI drafts
  - provider/platform integration semantics
inherits:
  - Master Playbook Standard 2.0-RC1
  - Universal Software & AI Engineering Master Playbook 2.0
related_playbooks:
  - 01 Requirements, Specification & Domain Engineering
  - 02 Software Architecture & System Design
  - 05 Verification, Validation, Testing & Quality Engineering
  - 06 Security Engineering
  - 08 Reliability, Resilience, Observability & SRE
  - 12 Data, Database & Storage Engineering
primary_archetype: Operating + Capability + Decision + Execution + Response
default_rigor: R3_CONTROLLED
```

> **Status note.** “Golden Master” means this is the canonical V2 research-audited synthesis produced after the documented V1 falsification pass. Under the parent Master Playbook Standard it remains `REVIEWED`, not `VALIDATED`, until representative non-author execution and field evidence are completed. It inherits the parent playbook-construction and engineering-control requirements rather than redefining them. [BASE01][BASE02]

---

# Executive standard

An API or message is not merely data crossing a boundary. It is a **distributed promise**.

The promise can be broken by:

- latency;
- independent failure;
- partial completion;
- unknown outcomes;
- retries;
- duplicated or reordered delivery;
- concurrent writers;
- stale replicas;
- clock uncertainty;
- version skew;
- load and queue buildup;
- untrusted provider data;
- lost callbacks;
- stale lock holders;
- recovery and replay;
- incompatible evolution.

The engineering objective is therefore:

> **Make meaning, state ownership, authority, time, failure, repetition, ordering, consistency, capacity, compatibility and repair explicit at every consequential distributed boundary.**

The canonical chain is:

```text
BUSINESS OUTCOME / INVARIANT
→ BOUNDARY + STATE OWNER
→ CONTRACT
→ INTERACTION MODEL
→ DELIVERY / ORDERING / CONSISTENCY
→ TIME BUDGET + CANCELLATION
→ RETRY + IDEMPOTENCY / DEDUPLICATION
→ PARTIAL FAILURE + RECOVERY / COMPENSATION
→ CAPACITY + BACKPRESSURE
→ SECURITY / TRUST
→ COMPATIBILITY + MIGRATION
→ VERIFICATION
→ OBSERVABILITY
→ RECONCILIATION / REPAIR
→ LEARNING + EVOLUTION
```

## The central doctrine

1. **A contract is more than a schema.**
2. **A remote call is not a local call with serialization.**
3. **Partial failure is a normal state, not an exceptional afterthought.**
4. **Unknown outcome is its own failure class.**
5. **Retry is a resource-consuming recovery tactic, not free reliability.**
6. **Idempotency belongs to the business effect and defined scope.**
7. **“Exactly once” without scope is not an engineering guarantee.**
8. **Ordering must name the key, boundary and stage where it holds.**
9. **Wall-clock time is not causal order.**
10. **Consistency is a user/business contract, not a database adjective.**
11. **Availability during a partition is an operation-level decision, not a CAP label.**
12. **Queues buffer bounded imbalance; they do not create capacity.**
13. **Backpressure, admission and overload behavior are correctness concerns.**
14. **Events are public contracts once another component depends on them.**
15. **Schema compatibility does not guarantee semantic compatibility.**
16. **Compensation is a forward action, not rollback through time.**
17. **A distributed lock without stale-owner protection can be unsafe.**
18. **Replay is a privileged production mutation.**
19. **DLQ/quarantine is inventory requiring ownership and repair.**
20. **Consequential external integrations require reconciliation.**
21. **Compatibility is demonstrated coexistence, not version numbering.**
22. **The safest distributed complexity is complexity not introduced.**

---

# V2 research and falsification verdict

V2 is the result of a deliberate V1 adversarial pass.

The audit attempted to falsify or bound:

- “exactly-once” claims;
- automatic retry guidance;
- idempotency-key assumptions;
- distributed-lock safety;
- CAP simplifications;
- consistency-model shortcuts;
- event ordering;
- outbox guarantees;
- saga semantics;
- DLQ/replay recovery;
- contract compatibility;
- webhook reliability;
- queue/backlog controls;
- current protocol/specification versions.

## Material corrections from V1

1. **Idempotency-Key is not an IETF final standard at this cutoff.** The former HTTPAPI Internet-Draft is expired. V2 standardizes the *behavioral contract*, not a universal field spelling. [IDEMPDRAFT01]
2. **RateLimit HTTP fields remain an active Internet-Draft.** Published baseline remains HTTP status/Retry-After semantics; draft fields are `EMG`. [RATEDRAFT01][RATE01]
3. **OpenAPI baseline is 3.2.1, published 10 September 2026.** [OAS01]
4. **AsyncAPI baseline is 3.1.0, released 31 January 2026.** [ASYNC01]
5. **GraphQL September 2025 is the latest released specification; September 2026 is a working draft.** [GQL01]
6. **OpenTelemetry messaging semantic conventions are still marked Development.** V2 uses W3C Trace Context as the stable propagation anchor and treats OTel field conventions as version-sensitive. [TRACE01][OTEL01]
7. **Exactly-once is decomposed by boundary.** Broker/platform claims cannot silently extend to external effects. [KAFKA01]
8. **Consistency selection now starts from full user/business behavior, including session guarantees, not a simplistic “weakest consistency” optimization.** [CONS01][CONS02]
9. **Distributed lock guidance now requires stale-owner/fencing reasoning.** [LOCK01]
10. **Replay, quarantine and reconciliation become first-class operational features.**

## Confidence

**HIGH confidence**:
- explicit contracts;
- partial-failure reasoning;
- bounded deadlines/work;
- retry caution;
- idempotency for duplicate-prone harmful effects;
- explicit ordering/consistency;
- compatibility testing;
- reconciliation for consequential integrations;
- overload/backpressure control.

**HIGH confidence with contextual implementation**:
- outbox/inbox;
- sagas;
- distributed locks/leases;
- consensus;
- event sourcing;
- CQRS;
- broker transactions;
- hedged requests.

**EMERGING / version-sensitive**:
- current IETF HTTPAPI rate-limit draft;
- vendor/platform-specific exactly-once capabilities;
- OpenTelemetry messaging semantic conventions;
- fast-changing API description tooling.

---

# 1. How to use this playbook

Use it when:

- defining an API or integration;
- extracting a service boundary;
- adding events, a broker or queue;
- designing a cross-service workflow;
- integrating a SaaS/provider;
- defining consistency or ordering;
- reviewing retry/idempotency behavior;
- planning compatibility/deprecation;
- investigating duplicate/missing/reordered work;
- building replay/reconciliation tooling;
- reviewing distributed failure modes.

For every material boundary, begin with:

```text
What must remain true?
Who owns the truth?
What can fail independently?
What can happen twice?
What can happen out of order?
What can be stale?
What can be unknown?
What can be overloaded?
How do old and new versions coexist?
How do we detect and repair divergence?
```

Do **not** begin with:

```text
REST or GraphQL?
Kafka or RabbitMQ?
Microservices or monolith?
Exactly once?
Event sourcing?
```

Those are implementation options, not the problem statement.

---

# 2. Scope and non-scope

## 2.1 In scope

- synchronous HTTP APIs;
- RPC/gRPC;
- GraphQL;
- WebSockets and streaming interactions;
- webhooks/callbacks;
- polling and synchronization;
- queues;
- publish/subscribe;
- logs/streams;
- event-driven architecture;
- external partner/SaaS integrations;
- distributed workflows;
- delivery semantics;
- idempotency/deduplication;
- ordering/causality/time;
- consistency and conflict semantics;
- distributed commit/compensation;
- coordination, locks, leases and fencing;
- retries/deadlines/cancellation;
- backpressure/admission/overload;
- API/event schema and semantic evolution;
- tracing/correlation;
- replay/reconciliation/repair.

## 2.2 Specialist boundaries

This playbook intentionally does not duplicate:

- detailed storage-engine design from Playbook 12;
- complete threat modeling/security control catalog from Playbook 06;
- complete SRE/SLO/incident practice from Playbook 08;
- full system-architecture method from Playbook 02;
- full testing method from Playbook 05.

Where a distributed boundary depends on those disciplines, the stricter applicable rule wins.

---

# 3. Normative language and claim taxonomy

The parent standard’s meanings apply:

- **MUST / MUST NOT** — house mandatory rule; deviation requires explicit exception/risk ownership.
- **SHOULD / SHOULD NOT** — strong default; context may justify deviation.
- **MAY** — optional.
- **JUDGMENT REQUIRED** — competent context-sensitive decision is intentionally required.

Claim labels:

- `REQ` — externally required in stated scope.
- `EST` — well-established engineering practice.
- `DEF` — recommended default.
- `CTX` — context-dependent pattern.
- `EMG` — emerging/version-sensitive.
- `HOUSE` — internal synthesis.
- `UNK` — important unresolved question.

Normative strength and evidence strength remain separate.

---

# 4. Evidence model

## 4.1 Evidence lanes

| Lane | Best use |
|---|---|
| formal protocol/specification | exact protocol semantics |
| foundational distributed-systems research | impossibility, consistency, ordering, coordination mechanisms |
| mature operational evidence | failure mechanisms under real production load |
| official platform documentation | scoped implementation guarantees |
| security/risk frameworks | threat/risk awareness and controls |
| local production evidence | whether the selected design works in this system |

A platform-specific guarantee is not generalized beyond its documented boundary.

## 4.2 Source-status discipline

V2 distinguishes:

```text
FINAL / RELEASED
DRAFT / WORKING DRAFT
EXPIRED DRAFT
DEPRECATED / SUPERSEDED
PLATFORM-SCOPED
HOUSE SYNTHESIS
```

The status itself is evidence.

---

# 5. Domain model — the distributed interaction contract

Every material distributed interaction SHOULD make the following recoverable:

```yaml
interaction_id:
business_outcome:
business_invariants:

producer_or_caller:
consumer_or_callee:
owners:

state:
  source_of_truth:
  writers:
  readers:
  authoritative_version:

trust:
  boundary:
  authentication:
  authorization:
  data_classification:

contract:
  protocol:
  schema:
  semantics:
  errors:
  preconditions:
  postconditions:

time:
  total_deadline:
  per_attempt_timeout:
  cancellation:
  event_time_semantics:

delivery:
  guarantee_scope:
  acknowledgement_point:
  duplicate_possible:
  loss_possible:
  replay_possible:

idempotency:
  required:
  scope:
  key_or_natural_identity:
  retention:
  concurrency_semantics:

ordering:
  required:
  scope:
  key:
  gap_behavior:
  late_event_behavior:

consistency:
  required_guarantees:
  stale_read_policy:
  session_guarantees:
  conflict_resolution:

failure:
  partial_failure_states:
  ambiguous_outcome:
  retry_policy:
  compensation_or_repair:

capacity:
  concurrency_limit:
  queue_bound:
  rate_limit:
  backpressure:
  load_shedding:
  fairness:

evolution:
  compatibility:
  versioning:
  deprecation:
  migration:

operations:
  telemetry:
  reconciliation:
  replay:
  quarantine:
  support_escalation:
```

Not every field is required for low-risk work. Material semantics MUST NOT remain implicit merely to keep the document short.

---

# 6. Distributed criticality overlay

Use the parent engineering criticality model, then increase assurance when the boundary adds:

- external money movement;
- irreversible side effects;
- cross-tenant data;
- security/identity authority;
- multi-region or cross-provider state;
- long replay windows;
- large fan-out;
- many independent consumers;
- weak ability to reconcile;
- hidden provider semantics;
- agent/autonomous callers;
- regulatory records.

For high-consequence boundaries:

- contract semantics SHOULD be machine-testable;
- idempotency/concurrency SHOULD be verified with race tests;
- duplicate/reorder/partition scenarios SHOULD be exercised;
- compatibility SHOULD be tested across mixed versions;
- replay/reconciliation SHOULD be rehearsed;
- independent review SHOULD challenge the failure model.

---

# 7. Golden Distributed Systems Standards

The following are the V2 root rules.

## Intent, boundaries and contracts

1. **Start with the business invariant, not the transport.**
2. **Name the authoritative state owner for every material fact.**
3. **Do not create two independent writable sources of truth without explicit conflict semantics.**
4. **Treat every network/process boundary as an independent-failure boundary unless the platform contract proves otherwise.**
5. **A contract MUST include material behavioral semantics, not only schema.**
6. **Validate semantically at trust/ownership boundaries; successful parsing is not correctness.**
7. **Define success, failure, timeout, cancellation and ambiguous-outcome behavior.**
8. **Define authorization separately from identity.**
9. **Define capacity/rate semantics where clients can exceed safe service levels.**
10. **Document consequential assumptions that are not enforced by the system.**

## Remote interaction and time

11. **A remote call MUST NOT be reasoned about as a local function call.**
12. **Material remote work SHOULD have a finite total deadline or explicit abandonment policy.**
13. **Per-attempt timeout MUST fit inside the total operation budget.**
14. **Timeout does not prove the remote side did nothing.**
15. **Where possible, propagate cancellation/deadline so abandoned downstream work stops consuming resources.**
16. **Use monotonic elapsed-time sources for local duration measurement where available.**
17. **Do not infer causal order from wall-clock timestamps without a stronger guaranteed time model.**

## Retries and repetition

18. **Retry only plausibly transient failure.**
19. **Retry only when repetition is safe, deduplicated, or prior non-application is known.**
20. **Retry MUST fit inside the remaining total deadline/resource budget.**
21. **Define one effective retry owner/locus per dependency chain where practical.**
22. **Budget attempts end-to-end; layered retries MUST NOT multiply without control.**
23. **Use backoff and de-correlation/jitter when simultaneous failures can synchronize clients.**
24. **Respect server/provider backpressure and `Retry-After` semantics where applicable.**
25. **Do not retry validation, authorization or deterministic business failures as if transient.**
26. **Hedging/speculative duplicate requests are `CTX`, not a default.**

## Idempotency and duplicates

27. **If harmful duplicate execution is plausible, the design MUST define duplicate safety.**
28. **Idempotency MUST name its scope and logical operation identity.**
29. **Idempotency storage MUST handle concurrent duplicates atomically when races are plausible.**
30. **A deduplication window MUST be derived from replay/retry horizon or backed by a natural invariant.**
31. **HTTP method idempotency does not automatically make the downstream business workflow idempotent.**
32. **Do not rely on a universally standardized `Idempotency-Key` HTTP header at this evidence cutoff; define the application contract explicitly.** [IDEMPDRAFT01]

## Delivery semantics

33. **Every delivery claim MUST name the boundary it covers.**
34. **Separate producer write, broker persistence, delivery, processing, state commit, external effect and business outcome.**
35. **Design for duplicate effects whenever redelivery cannot be ruled out.**
36. **Do not use unsuffixed “exactly once” in architecture/release claims.**
37. **A broker transaction does not automatically include an external database/API/email/payment side effect.**
38. **Acknowledge only at a point consistent with the loss/duplicate semantics the business can tolerate.**

## Messaging/events

39. **Use asynchronous messaging only when buffering, fan-out, temporal decoupling, replay or independent consumption earns its operational cost.**
40. **Classify a message as command, notification event, state-transfer event, integration event, raw CDC record or snapshot/rebuild artifact.**
41. **Events SHOULD describe durable domain meaning rather than accidental storage shape unless raw CDC is intentionally the contract.**
42. **Message/event contracts MUST have owners.**
43. **Retention, replay and deletion are contract/lifecycle semantics, not broker housekeeping.**
44. **Poison-message handling MUST distinguish transient from deterministic failure.**
45. **A DLQ/quarantine MUST have an owner, repair/replay path and age/volume signal.**
46. **Replay MUST be treated as a privileged production mutation.**

## Ordering, causality and time

47. **Ordering MUST state scope: connection, session, key, partition, stream or global.**
48. **Do not pay for global total order when the invariant only needs per-entity order.**
49. **Parallel processing can destroy completion order even when delivery order is preserved.**
50. **Consumers MUST define behavior for duplicate, missing, late and out-of-order messages when those states are plausible.**
51. **Use version/sequence/state-machine checks when stale writes are harmful.**
52. **Event time, ingestion time, processing time and commit time MUST NOT be conflated.**

## Consistency and replication

53. **Select consistency from user/business behavior and failure requirements, not database labels.**
54. **State whether callers need linearizability, transactional serializability, causal/session guarantees, bounded staleness or eventual convergence where material.**
55. **Read-your-writes and monotonic reads are first-class UX/API requirements when replicas/caches can violate them.**
56. **Conflict resolution MUST be explicit when multiple writers can diverge.**
57. **Last-write-wins based on wall-clock time MUST NOT be used for material conflicts without justified clock/semantic assumptions.**
58. **CAP MUST NOT be summarized as an unconditional “pick two” architecture rule.**
59. **During partition, define which operations preserve consistency, which remain available, and how recovery/reconciliation occurs.**

## Transactions and workflows

60. **Keep a strongly atomic invariant inside one transactional owner when practical.**
61. **Do not distribute an invariant merely to preserve architectural fashion.**
62. **Use distributed commit only when atomic cross-participant commit is actually required and supported.**
63. **Treat classic 2PC blocking/recovery characteristics as part of the decision.** [TX01]
64. **Use sagas only when intermediate states and compensations are semantically acceptable.** [SAGA01]
65. **Compensation is a new action and may fail; it is not guaranteed rollback.**
66. **Classify workflow steps as reversible, compensatable, non-compensatable or externally irreversible.**
67. **Any cross-service outcome with timeout/compensation/completion requirements MUST have an identifiable workflow owner, even if implemented via choreography.**
68. **Persist long-running workflow state so it can resume after process failure.**

## Coordination, locks and consensus

69. **A distributed lock/lease is not safe authority merely because the client believes it holds it.**
70. **Where stale actors can cause harm, protected resources SHOULD enforce fencing/epoch/sequencer semantics.** [LOCK01]
71. **Use conditional writes/version checks when they can satisfy the invariant with less coordination.**
72. **Do not implement bespoke consensus/leader election casually; use mature proven mechanisms.**
73. **Consensus assumptions, quorum membership and failure model MUST be explicit for systems that depend on them.**
74. **Do not confuse consensus, replication and atomic commit; they solve related but distinct problems.**

## Capacity, queues and overload

75. **A queue MUST have a bound or an explicit external capacity limit.**
76. **Queue health MUST consider age/lag and processing rate, not depth alone.**
77. **Define maximum in-flight concurrency where resource exhaustion is possible.**
78. **Backpressure SHOULD propagate rather than silently turning into infinite buffering.**
79. **Use admission control/rate limiting/load shedding before saturation causes cascading failure where the domain permits.**
80. **Retry policy MUST become more conservative during overload.**
81. **Shared systems SHOULD define tenant/key fairness or isolation where one producer can starve others.**
82. **Test overload and recovery from backlog, not only peak happy-path throughput.**

## External integrations

83. **Treat provider/partner data as untrusted input.**
84. **Wrap volatile provider-specific semantics behind owned adapters when change risk justifies it.**
85. **Do not assume sandbox and production are semantically identical.**
86. **For consequential external state, callbacks SHOULD be complemented by authoritative status/reconciliation where available.**
87. **Webhook delivery MUST tolerate duplicates and, unless explicitly guaranteed otherwise, reordering and delay.**
88. **Webhook authenticity and replay protection are separate concerns.**
89. **Monitor provider quotas/rate limits/version/deprecation and support status.**
90. **External integration design SHOULD include an exit/data-portability path proportional to dependency criticality.**

## Compatibility and evolution

91. **Prefer additive/compatible evolution while dependent consumers remain live.**
92. **Schema compatibility MUST NOT be equated with semantic compatibility.**
93. **Test mixed producer/consumer versions for material contracts.**
94. **A breaking change includes changed meaning, defaults, units, error/retry semantics, ordering, auth, partitioning and freshness—not only removed fields.**
95. **Version numbers communicate intent; they do not create compatibility.**
96. **Deprecation MUST include replacement/migration/support window/removal criteria.**
97. **Use published protocol deprecation/sunset signals where they fit, but do not rely on signaling alone to migrate consumers.**
98. **Maintain usage/inventory evidence before removing externally consumed behavior.**

## Security, observability and operations

99. **Every integration boundary MUST retain appropriate authentication, authorization, input validation and resource controls.**
100. **A trusted network location is not authorization.**
101. **Trace/correlation identifiers MUST NOT become bearer credentials or trusted identity.**
102. **Consequential operations SHOULD be reconstructable across attempts, components and side effects.**
103. **Observe retries, timeouts, duplicates, queue age, reconciliation drift and contract rejects—not only request success.**
104. **Reconciliation and repair tools are production capabilities and require access control/auditability.**
105. **Runbooks MUST include ambiguous outcome, replay and provider outage paths where material.**

## Simplicity and decision quality

106. **Prefer the least distributed design that meets the real requirement.**
107. **Do not add brokers, service boundaries, global ordering, distributed locks, event sourcing or sagas without a concrete problem they solve.**
108. **Do not cargo-cult a hyperscaler’s topology; adopt the mechanism only if the failure/scale condition applies.**
109. **When evidence is context-dependent, encode the boundary condition rather than a universal slogan.**
110. **The final test is demonstrated behavior under real failure, load and version change—not architecture vocabulary.**

---

# 8. Contract engineering standard

## 8.1 Contract = syntax + semantics + operations

A robust contract can include:

| Dimension | Questions |
|---|---|
| identity | What operation/resource/event is this? |
| input | What is accepted? |
| semantic validation | What values/relationships are legal? |
| output | What state/result is returned? |
| authority | Who may do this to what? |
| preconditions | What must already be true? |
| postconditions | What becomes true? |
| invariants | What must never be violated? |
| errors | What stable categories can callers act on? |
| time | Deadline, timeout, cancellation? |
| repeat | Retry/idempotency/dedupe? |
| order | What ordering is guaranteed? |
| consistency | How fresh/strong is state? |
| concurrency | What happens on conflicting writes? |
| capacity | Rate, quota, payload, concurrency? |
| compatibility | How do versions coexist? |
| lifecycle | Deprecation/sunset/removal? |
| operations | Telemetry, support, replay, reconciliation? |

## 8.2 Machine-readable descriptions

Machine-readable descriptions SHOULD be used where they reduce ambiguity/tooling cost.

Current examples at cutoff:

- OpenAPI 3.2.1 for HTTP APIs. [OAS01]
- AsyncAPI 3.1.0 for message-driven APIs. [ASYNC01]
- JSON Schema 2020-12 for JSON validation/schema contexts. [JSON01]
- CloudEvents 1.0.2 for a transport-independent event envelope. [CE01]

These artifacts do **not** prove the deployed system conforms.

## 8.3 Contract source of truth

Every production contract SHOULD have:

```yaml
contract_id:
owner:
version:
status:
canonical_location:
implementation_versions:
consumers:
compatibility_policy:
deprecation_policy:
last_verified:
```

Avoid “the wiki says one thing, generated client another, production another.”

## 8.4 Code-first vs contract-first

Both are valid `CTX` workflows.

**Contract-first** is favored when:
- external consumers integrate independently;
- compatibility windows are long;
- generated SDK/docs are important;
- regulated/audited interface evidence matters.

**Code-first** is favored when:
- one team owns both sides;
- behavior changes rapidly;
- generated contract + implementation conformance are automatic.

Release gate:

> **Whichever artifact is canonical, deployed behavior MUST be tested against it.**

## 8.5 Semantic compatibility matrix

For a material change, evaluate:

```yaml
syntax:
field_meaning:
units:
nullability:
defaults:
enum_semantics:
errors:
retryability:
idempotency:
ordering:
freshness:
authorization:
rate_limits:
pagination:
partitioning:
side_effects:
```

“Field still exists” is not enough.


---

# 9. HTTP API engineering

HTTP is a mature application protocol with defined semantics. Use those semantics rather than treating HTTP as a generic tunnel when they fit the domain. [HTTP01]

## 9.1 Method semantics

RFC 9110 defines safe and idempotent method semantics. In particular, PUT, DELETE and safe methods are idempotent at the HTTP method-semantic level. [HTTP01]

Important boundary:

> HTTP idempotency describes the intended effect of repeated identical requests on the server resource semantics. It does not automatically make emails, payments, downstream jobs or other side effects idempotent.

A client SHOULD NOT automatically retry a non-idempotent request unless it knows the operation is safe to repeat or can establish that the original was not applied. [HTTP01]

## 9.2 Resource vs action modeling

Prefer resource semantics when the domain naturally exposes durable resources and state transitions.

Action-oriented endpoints are acceptable when:

- the operation is not naturally CRUD-like;
- forcing it into resource vocabulary reduces clarity;
- the side effect/command itself is the domain concept.

Do not optimize URL aesthetics over contract meaning.

## 9.3 Errors

HTTP APIs SHOULD use:

- HTTP status semantics appropriately;
- a stable application error taxonomy where clients need branching;
- machine-readable problem detail where appropriate.

RFC 9457 defines Problem Details for HTTP APIs and supersedes RFC 7807. [HTTP02]

Error contracts SHOULD separate:

```text
INVALID INPUT
UNAUTHENTICATED
UNAUTHORIZED
NOT FOUND / HIDDEN
CONFLICT / PRECONDITION
RATE / CAPACITY
TRANSIENT DEPENDENCY
INTERNAL FAILURE
AMBIGUOUS OUTCOME
```

Do not expose stack traces or sensitive internal details.

## 9.4 Optimistic concurrency and lost updates

When a client updates state derived from a prior read and lost updates matter, use a conditional mutation mechanism such as:

- `ETag` + `If-Match`;
- domain version;
- compare-and-set;
- transactional version predicate.

RFC 6585 defines `428 Precondition Required` as one optional protocol mechanism to require conditional requests. [RATE01]

## 9.5 Throttling and overload

Published HTTP building blocks include:

- `429 Too Many Requests`; [RATE01]
- `Retry-After` semantics. [HTTP01]

At the evidence cutoff, the IETF HTTPAPI `RateLimit` field specification remains an Internet-Draft and MUST be treated as work in progress, not a final RFC. [RATEDRAFT01]

Distinguish:

- policy quota exhausted;
- temporary resource saturation;
- dependency unavailable;
- abuse/attack.

A server under severe overload may need to drop/reject work earlier rather than spend scarce resources constructing rich error responses.

## 9.6 Pagination

Pagination MUST define stable semantics if results can change during traversal.

Consider:

- offset pagination;
- cursor/keyset pagination;
- snapshot/consistent pagination;
- continuation tokens.

For large/changing datasets, cursor/keyset approaches often avoid offset drift, but the correct choice depends on query semantics.

A continuation token SHOULD be opaque unless exposing its representation is intentionally part of the public contract.

Define:

```yaml
ordering:
stable_key:
page_size_limits:
snapshot_or_live:
cursor_expiry:
duplicates_possible:
missing_items_possible:
```

## 9.7 Partial updates

PATCH-like behavior must define:

- patch media/semantics;
- null vs omitted;
- validation order;
- atomicity of fields;
- concurrency/precondition behavior.

Do not invent ambiguous “partial object replacement” semantics.

## 9.8 Long-running operations

Do not hold a synchronous request open merely because the operation was initiated synchronously.

For long-running work, consider:

```text
POST /operations
→ 202 Accepted
→ operation/status resource
→ cancellation if supported
→ terminal result
```

The actual resource design is contextual; the durable principle is that callers can determine whether work is pending, succeeded, failed, cancelled or requires reconciliation.

## 9.9 Deprecation and sunset

RFC 9745 defines the `Deprecation` HTTP response header. RFC 8594 defines `Sunset`. [HTTP03][HTTP04]

These MAY supplement a migration program. They do not replace:

- direct consumer communication;
- telemetry;
- migration tooling;
- support window;
- removal governance.

---

# 10. RPC and gRPC engineering

RPC is appropriate when procedure/service semantics, typed tooling, streaming, or low-latency internal calls are a better fit than resource-oriented HTTP.

The key rule is:

> **RPC syntax MUST NOT create the illusion that the call is local.**

## 10.1 Required remote-call semantics

A material RPC SHOULD define:

```yaml
deadline:
cancellation:
status_codes:
retryable_statuses:
idempotency:
payload_limits:
streaming_behavior:
backpressure:
compatibility:
authentication:
authorization:
```

## 10.2 Deadlines

gRPC’s official guidance notes that a client can otherwise wait effectively forever if no deadline is configured, and recommends explicit realistic deadlines. [GRPC01]

Deadline design SHOULD begin from the caller’s total budget and allocate downstream budgets, not pick arbitrary per-service constants.

## 10.3 Cancellation

Caller timeout and server cancellation are different.

On cancellation:

- stop work that no longer provides value where safe;
- propagate cancellation downstream where supported;
- do not corrupt shared state merely because the caller disappeared;
- make committed side effects discoverable/reconcilable.

## 10.4 Retries

gRPC provides configurable retry behavior, but application design still owns which operations are safe to retry and the total retry budget. [GRPC02]

Transparent/library retry MUST NOT hide an unbounded number of attempts from:

- SLO accounting;
- billing;
- downstream capacity;
- idempotency logic;
- incident diagnosis.

## 10.5 Streaming RPC

Streaming adds:

- flow control;
- long-lived connection state;
- reconnect/resume semantics;
- message ordering;
- duplicate/gap handling;
- per-stream authorization;
- partial progress.

A stream is not automatically a durable event log.

---

# 11. GraphQL engineering

The latest released GraphQL specification at the evidence cutoff is **September 2025**; a September 2026 working draft exists but is not the released baseline. [GQL01]

GraphQL is useful when:

- clients need flexible selection;
- a unified typed schema materially reduces client coupling;
- multiple backing systems can be composed without exposing their topology.

GraphQL does not remove distributed-system concerns.

## 11.1 Protect

- object and field authorization;
- query depth/complexity;
- resolver fan-out;
- N+1 behavior;
- batching/caching correctness;
- pagination;
- partial errors;
- mutation idempotency;
- schema deprecation;
- operation-level observability.

## 11.2 Partial result semantics

A response can contain data and errors. Consumers MUST understand which returned data can be trusted/used after partial failure.

## 11.3 Schema evolution

Additive schema change is generally easier to evolve, but changed resolver semantics/defaults/performance can still break clients.

Use deprecation metadata plus usage evidence before removal.

## 11.4 Federation/composition

Federation creates additional contracts:

- entity identity;
- ownership;
- resolver dependency;
- cross-service authorization;
- failure propagation;
- latency amplification.

Treat the composed graph as a distributed system, not merely a schema tool.

---

# 12. WebSocket, server push and long-lived channels

Use a long-lived bidirectional channel when low-latency two-way interaction materially requires it. RFC 6455 is the core WebSocket protocol baseline, with later updates. [WS01]

Define:

- connection authentication and reauthentication;
- authorization per message/action;
- heartbeat/liveness;
- maximum idle/lifetime;
- reconnect policy;
- resume token/position if any;
- ordering;
- duplicate handling;
- flow control/backpressure;
- message-size bounds;
- server deployment/drain behavior.

A connection being open is not evidence that the application on the other side is healthy.

For server→client streaming alternatives such as SSE, account for one-way semantics, reconnect behavior and event identifiers. Protocol choice remains contextual.

---

# 13. Webhook and callback engineering

Webhooks are an **at-least-uncertain delivery boundary** unless the provider contract states and demonstrates stronger semantics.

Assume, unless proven otherwise:

- duplicates;
- delay;
- reordering;
- bursts;
- retry after receiver error;
- callback loss;
- provider-side replay;
- key rotation.

## 13.1 Receiver pipeline

```text
RECEIVE
→ AUTHENTICATE / VERIFY
→ BOUND SIZE / PARSE
→ VALIDATE SEMANTICS
→ CHECK REPLAY / EVENT ID
→ DURABLY RECORD ACCEPTANCE
→ ACK WITHIN PROVIDER DEADLINE
→ PROCESS
→ RECORD OUTCOME
→ RECONCILE IF CONSEQUENTIAL
```

## 13.2 Authenticity vs replay

A valid signature can prove integrity/authenticity under its cryptographic assumptions. It does not by itself prove:

- freshness;
- uniqueness;
- authorization for the business effect;
- that the event has not already been processed.

RFC 9421 defines HTTP Message Signatures as one building block and explicitly does not constitute a complete application-security design. [SIG01]

## 13.3 Quick acknowledgement

If provider retry behavior is triggered by slow responses, persist acceptance then acknowledge before expensive downstream processing.

Do not acknowledge before durable acceptance if losing the event would violate the contract.

## 13.4 Reconciliation

For consequential provider state:

```text
WEBHOOK = low-latency signal
AUTHORITATIVE PROVIDER READ = truth check
RECONCILIATION = repair mechanism
```

Examples include:

- payments;
- subscriptions;
- identity provisioning;
- shipments;
- bookings;
- financial/usage records.

Reconciliation cadence SHOULD reflect consequence and allowed staleness.

---

# 14. Polling and synchronization

Polling is appropriate when:

- provider has no callback;
- callbacks are advisory rather than authoritative;
- correctness requires periodic state comparison;
- the acceptable freshness interval is known.

Define:

```yaml
poll_interval:
jitter:
cursor_or_watermark:
pagination:
rate_budget:
backfill_window:
overlap_window:
deduplication:
clock_assumptions:
deletion_detection:
reconciliation_rule:
```

## 14.1 Incremental polling

Use a durable cursor/watermark rather than only “now minus N” where the provider supports one.

If filtering by timestamps:

- use overlap to tolerate clock/delivery delay;
- deduplicate;
- record provider timezone/precision;
- do not assume `updated_at` is strictly monotonic unless documented.

## 14.2 Deletion

Incremental APIs often make deletion harder than creation/update.

Define whether deletion is discovered by:

- tombstone;
- changed-since feed;
- periodic full reconciliation;
- explicit webhook;
- inventory comparison.

---

# 15. Messaging and event-driven architecture

## 15.1 Reasons that justify messaging

Messaging is justified by one or more explicit needs:

- buffering bursts;
- decoupling availability windows;
- fan-out;
- independent consumer scaling;
- durable asynchronous work;
- replay/history;
- cross-system integration;
- stream processing.

“Decoupling” alone is too vague.

## 15.2 Costs introduced

- broker operation/dependency;
- asynchronous debugging;
- duplicate delivery;
- replay;
- ordering;
- schema evolution;
- eventual consistency;
- lag/backlog;
- poison messages;
- state reconstruction;
- cross-service causal reasoning.

## 15.3 Message taxonomy

### Command

Intent to cause an action, normally with a target capability.

Example:
`CreateInvoice`

### Domain-event notification

Fact that something occurred; payload may be minimal.

Example:
`CustomerAddressChanged`

### Event-carried state transfer

Event includes enough state for a consumer to avoid synchronous lookup.

Benefit: fewer runtime dependencies.

Cost: larger contract and more duplicated/stale data.

### Integration event

A deliberately public/stable event projected from internal domain behavior for external consumers.

### CDC/raw change record

Storage-level mutation.

Use for infrastructure/data propagation where appropriate. Do not call it a stable business-domain API by accident.

### Snapshot/rebuild artifact

State used for bootstrap/recovery, not necessarily a live domain event.

## 15.4 Command vs event naming

Use past-tense fact names for events where language permits.

Avoid hidden commands disguised as events:

Bad:
`InvoiceShouldBeCreatedEvent`

Better:
- command: `CreateInvoice`
- fact: `OrderConfirmed`

## 15.5 Event envelope

A useful envelope MAY include:

```yaml
event_id:
event_type:
source:
subject:
occurred_at:
published_at:
schema_version:
correlation_id:
causation_id:
trace_context:
content_type:
payload:
```

CloudEvents 1.0.2 is a current stable open specification that can provide portable envelope conventions. [CE01]

Do not force every domain to expose irrelevant fields merely to satisfy a template.

---

# 16. Message-driven contract description

AsyncAPI 3.1.0 is a current machine-readable specification for message-driven APIs and is protocol-agnostic. [ASYNC01]

Use a message contract to describe, as applicable:

- channel/address;
- sender/receiver;
- operation;
- message schema;
- headers;
- correlation;
- protocol binding;
- security;
- examples;
- server endpoints.

But runtime guarantees such as delivery, ordering, transactionality, retry and retention depend on actual broker/protocol/configuration and MUST be documented/tested separately.

---

# 17. Queue, pub/sub and stream selection

## 17.1 Work queue

Best fit:

- one logical worker group handles each item;
- completion/acknowledgement matters;
- retry/quarantine are operational primitives.

## 17.2 Pub/sub

Best fit:

- multiple independent subscribers react to a fact;
- each subscriber can fail independently;
- publisher should not enumerate every reaction.

## 17.3 Durable log/stream

Best fit:

- retained history is valuable;
- independent consumer positions matter;
- replay/rebuild is a requirement;
- per-key/partition ordering is useful.

## 17.4 Broker protocols

AMQP 1.0 and MQTT 5.0 are examples of standardized messaging protocols with different target semantics and features. [AMQP01][MQTT01]

Do not infer broker behavior from the word “queue”, “topic” or “QoS” alone. Read the exact platform/protocol contract.

---

# 18. Delivery semantics — exact scope required

The phrase **delivery guarantee** is incomplete without a boundary.

Use this matrix:

| Stage | Question |
|---|---|
| producer call | Did producer know publish succeeded? |
| broker ingress | Did broker accept it? |
| broker durability | Is it durably replicated under stated failures? |
| broker delivery | Can consumer receive it more than once? |
| consumer execution | Can handler run more than once? |
| local commit | Can handler effect commit more than once? |
| offset/ack | Is processing state committed with effect? |
| external effect | Can another service/payment/email execute twice? |
| business outcome | Can the real-world action happen twice? |

## 18.1 At-most-once

A scoped guarantee where loss can occur but redelivery is prevented in that scope.

Use only when loss is acceptable or recoverable from another source.

## 18.2 At-least-once

A scoped guarantee where redelivery is possible.

This often provides stronger durability but requires duplicate-safe processing.

## 18.3 Exactly-once

An exactly-once claim MUST document:

```yaml
scope:
inputs:
state_stores:
transaction_boundary:
consumer_position:
failures_covered:
rebalances_restarts:
external_effects_in_scope:
external_effects_out_of_scope:
```

Apache Kafka 4.3 is a useful scoped example: Kafka can coordinate consumer position and produced Kafka records transactionally, while exactly-once behavior for other destination systems generally requires cooperation from those systems. [KAFKA01]

### Golden rule

> **Exactly-once transport or processing is not automatically exactly-once business effect.**

## 18.4 Acknowledgement point

The ack/offset commit point determines loss-vs-duplicate trade-offs.

```text
ACK BEFORE EFFECT
→ crash can lose processing

EFFECT BEFORE ACK
→ crash can duplicate processing

EFFECT + ACK IN SAME TRANSACTION
→ stronger scoped atomicity if supported
```

State this deliberately.

---

# 19. Idempotency standard

## 19.1 Definition

For this playbook, a logical operation is idempotent when repeated attempts for the same operation identity do not produce additional unintended business effect.

This is stronger than merely returning the same HTTP status.

## 19.2 Natural idempotency

Examples:

- `set status = CANCELLED`;
- upsert by immutable business key;
- replace resource at a stable URI.

Even natural idempotency must consider secondary effects such as notifications/audit/spend.

## 19.3 Explicit idempotency key

Use when:

- caller may retry;
- operation creates an entity/side effect;
- natural identity is insufficient.

Contract:

```yaml
key:
scope:
tenant_or_principal:
request_fingerprint:
state:
  - IN_PROGRESS
  - SUCCEEDED
  - FAILED_RETRYABLE
  - FAILED_FINAL
response_replay:
concurrency:
retention:
expiry_behavior:
```

## 19.4 Atomic claim

Two concurrent requests with the same key MUST NOT both independently pass the “not seen” check and perform the effect.

Use:

- unique constraint;
- transactional insert-if-absent;
- compare-and-set;
- serializing state owner.

## 19.5 Request fingerprint

If the same key arrives with materially different parameters:

- reject;
- do not silently treat as same logical operation.

## 19.6 Result replay

Where practical, a completed key SHOULD replay the original semantic outcome rather than re-execute.

## 19.7 Retention

Retention must cover the plausible duplicate/replay horizon **or** a stronger natural invariant must continue protecting the effect. AWS’s current idempotent-API guidance independently reinforces caller-provided request identity and repeatable semantic outcomes as a practical pattern; this playbook treats that as operational evidence, not a universal wire-format mandate. [IDP01]

## 19.8 HTTP field status

An IETF HTTPAPI draft for an `Idempotency-Key` field existed but is expired/archived at the evidence cutoff. [IDEMPDRAFT01]

Therefore:

- the pattern is valid;
- the behavior is strongly recommended where needed;
- the header name MUST NOT be represented as a current final IETF standard.

---

# 20. Deduplication and inbox processing

Deduplication asks “have we already accepted/processed this identity?” Idempotency asks “would repetition change the intended business outcome?”

Use both concepts deliberately.

## 20.1 Transactional inbox

A consumer can atomically:

1. claim message identity;
2. apply local state change;
3. record processing outcome.

This provides strong local duplicate handling when stored in one transaction.

## 20.2 Dedupe identity

Prefer stable event/operation ID.

Do not hash the entire payload as the sole identity unless the domain genuinely defines equality that way.

## 20.3 Dedupe cleanup

Define:

- TTL;
- compaction;
- archival;
- maximum replay age;
- behavior after expiry.

A cleanup job can silently weaken duplicate safety if not connected to replay policy.

---

# 21. Ordering, causality and time

Lamport’s happened-before relation establishes that distributed events naturally form a partial causal order and that physical clocks do not by themselves provide a universal causal order. [DIST01]

## 21.1 Time taxonomy

```text
EVENT TIME
when domain event happened

PUBLISH TIME
when producer emitted

INGEST TIME
when broker/system accepted

PROCESSING TIME
when consumer handled

COMMIT TIME
when a state store made effect durable

WALL CLOCK
physical timestamp

MONOTONIC ELAPSED TIME
local duration

LOGICAL / CAUSAL ORDER
dependency relation among events
```

Never leave “timestamp” undefined when correctness depends on it.

## 21.2 Ordering scopes

Possible scopes:

- per connection;
- per producer session;
- per queue;
- per key/entity;
- per partition;
- per log;
- total global.

The stronger the scope, the more serialization/coordination can be required.

## 21.3 Ordering key

Choose a key that corresponds to the invariant.

Example:

```text
all state changes for order_id
→ same ordering key
```

Do not partition by random message ID if state transitions for one entity require sequence.

## 21.4 Delivery order vs completion order

Even if broker delivery is ordered:

```text
message 1 → worker A → slow
message 2 → worker B → fast
```

completion can be reversed.

If completion order matters, control consumer concurrency by key or use state/version guards.

## 21.5 Gaps

If sequence 10 arrives before 9:

choose explicitly:

- wait/buffer;
- process 10 because operations commute;
- reject/retry;
- fetch missing state;
- reconcile from source of truth.

## 21.6 Late events

Define whether an older event:

- is ignored;
- is merged;
- reopens state;
- triggers compensation;
- is applied only if version matches.

## 21.7 Clock-based last-write-wins

`CTX` only.

Unsafe when:

- clocks are not sufficiently bounded;
- business priority differs from time;
- late delivery can overwrite a valid newer state.

Google Spanner demonstrates that strong externally consistent time-based semantics require explicit clock-uncertainty machinery, not casual timestamp comparison. [SPAN01]

---

# 22. Consistency model standard

Consistency is the set of observations the system promises under concurrency, replication and failure.

## 22.1 Do not say only “strong” or “eventual”

Document the actual guarantee.

### Linearizability

Operations appear to take effect atomically at some point between invocation and response, respecting real-time ordering. [CONS01]

Useful when:

- a single-object/current-state illusion is required;
- stale reads after acknowledged writes are unacceptable.

Cost depends on architecture/geography/failure mode.

### Transactional serializability

Concurrent transactions behave as if executed in a serial order.

This does not automatically imply real-time/external ordering.

Detailed database transaction semantics belong to Playbook 12.

### External consistency / strict serializability

Transaction order also respects external real-time precedence.

Spanner is a concrete implementation example, not a requirement for all systems. [SPAN01]

### Causal consistency

Observations preserve causal dependencies while allowing unrelated operations greater concurrency.

### Session guarantees

Terry et al. identify:

- read-your-writes;
- monotonic reads;
- writes-follow-reads;
- monotonic writes. [CONS02]

These can be exactly the user-facing guarantees a replicated application needs without requiring global linearizability.

### Bounded staleness

Reads can lag by a defined time/version bound.

### Eventual convergence

Replicas can temporarily diverge but converge if updates stop and conflict semantics permit.

“Eventually consistent” MUST state what conflicts do and what user experience is possible before convergence.

## 22.2 Selection rule

Choose the **least coordination-intensive model that demonstrably satisfies**:

- domain invariant;
- user/session expectation;
- audit/compliance need;
- failure behavior;
- recovery behavior.

Do not choose weaker consistency merely for benchmark throughput if it transfers unacceptable complexity to users/operators.

## 22.3 Conflict resolution

Possible strategies:

- reject concurrent update;
- optimistic concurrency/version check;
- deterministic merge;
- domain-specific merge;
- commutative operation;
- CRDT where semantics fit;
- last-write-wins;
- manual resolution.

Conflict resolution MUST preserve domain validity, not merely converge bytes.

---

# 23. CAP and partition behavior

Gilbert and Lynch formalized the trade-off among consistency and availability under network partition in a specific asynchronous model. [CAP01]

Brewer later emphasized that CAP should not be used as a simplistic permanent “pick two” classification; partition handling can vary by operation and phase. [CAP02]

## 23.1 Required partition questions

```text
If replicas cannot communicate:
- Which reads can continue?
- Which writes can continue?
- What guarantee is preserved?
- What is rejected?
- What state can diverge?
- How is divergence represented?
- How is it reconciled?
- What does the user see?
- How do we know partition recovery is complete?
```

## 23.2 Do not label a whole system casually

A system can have:

- strongly consistent metadata;
- eventually convergent content;
- read-only availability during partition;
- region-local writes;
- global delayed reconciliation.

Describe operation-level behavior.

---

# 24. Distributed transactions and atomic commit

## 24.1 Keep atomic invariants local when practical

If one invariant must change atomically and one service/data owner can legitimately own it, that is usually simpler than cross-service commit.

## 24.2 Dual-write problem

Bad:

```text
UPDATE DATABASE
then
PUBLISH MESSAGE
```

Possible:

```text
DB succeeds
publish fails
```

Reverse order has the inverse gap.

Use a mechanism that explicitly closes the gap rather than hoping retry timing does.

## 24.3 Two-phase commit

Classic 2PC coordinates atomic commit among participants.

Gray and Lamport show that classic 2PC can block when the coordinator fails; fault-tolerant consensus-based commit changes the availability/message trade-off. [TX01]

2PC is `CTX`.

Use when:
- participants support it correctly;
- atomicity justifies latency/operational coupling;
- recovery behavior is acceptable.

Do not add distributed transaction coordinators for ordinary integration convenience.

---

# 25. Saga and long-running workflow standard

The original saga model decomposes a long-lived transaction into transactions plus compensating transactions. [SAGA01]

## 25.1 Use when

- one atomic transaction is unavailable/undesirable;
- intermediate states are acceptable;
- a durable workflow can continue/recover;
- compensation semantics exist.

## 25.2 Step classification

```yaml
step:
effect:
class: REVERSIBLE | COMPENSATABLE | NON_COMPENSATABLE | IRREVERSIBLE
idempotency:
timeout:
retry:
compensation:
compensation_idempotency:
manual_repair:
```

Order irreversible/non-compensatable steps deliberately.

## 25.3 Compensation limits

Examples:

- refund is not “payment never happened”;
- cancellation notification cannot make a sent email unseen;
- inventory release may fail after another buyer took capacity;
- external regulatory action may be irreversible.

The workflow must model real-world state, not pretend compensation restores history.

## 25.4 Durable workflow state

Persist:

- workflow ID;
- current state;
- completed steps;
- operation IDs;
- deadlines;
- retry schedule;
- compensation status;
- terminal/manual states.

A process-memory saga is not durable orchestration.

---

# 26. Orchestration vs choreography

## Orchestration

Prefer when:

- sequence matters;
- there is a clear end-to-end outcome;
- timeout/compensation are central;
- audit/progress status matters.

Costs:
- coordinator dependency;
- potential central coupling.

## Choreography

Prefer when:

- subscribers truly own independent reactions;
- no hidden global sequence exists;
- publisher should not know consumers.

Costs:
- emergent workflows;
- difficult completion semantics;
- distributed debugging;
- hidden dependency chains.

## Golden rule

> A critical cross-service business outcome MUST have an owner even if no central orchestrator exists.

---

# 27. Transactional outbox / inbox

## 27.1 Outbox

Pattern:

```text
LOCAL DB TRANSACTION:
  domain state
  + outbox record
COMMIT

relay publishes outbox
mark/advance relay state
```

Purpose:

> eliminate the gap between committing local state and durably recording intent to publish.

It does **not** guarantee:
- one network delivery;
- one consumer execution;
- one external effect.

The relay may publish duplicates. Consumers still require appropriate duplicate safety.

## 27.2 Inbox

Pattern:

```text
consume message
LOCAL DB TRANSACTION:
  claim message/event ID
  + state effect
COMMIT
ack broker
```

Useful for local exactly-once-effect semantics under stated failure assumptions.

## 27.3 Outbox retention

Retain enough to:
- recover relay failures;
- audit;
- replay if intended.

Do not retain unboundedly by accident.

---

# 28. Change Data Capture

CDC is `CTX`.

Good uses:

- feed analytics/search/indexes;
- migrate systems;
- capture changes from legacy systems;
- build reliable propagation from committed database log.

Risks:

- storage schema becomes external contract;
- deletes/tombstones mishandled;
- transaction boundaries lost;
- ordering across tables unclear;
- backfill/live stream overlap;
- sensitive columns leaked;
- schema migrations break consumers.

For domain integrations, prefer deliberate integration events unless raw change semantics are intentionally the interface.

---

# 29. Distributed locks, leases, fencing and leadership

## 29.1 The stale-holder problem

```text
A acquires lease epoch 41
A pauses
lease expires
B acquires epoch 42
B writes
A resumes
A writes late
```

If the protected resource accepts A’s late write, mutual exclusion at the lock service did not protect the real state.

## 29.2 Fencing

Use a monotonic token/epoch/sequencer that the protected resource verifies:

```text
request epoch <= last accepted epoch
→ reject stale request
```

Chubby includes sequencer concepts specifically to allow downstream validation of lock ownership. [LOCK01]

## 29.3 Lease semantics

Define:

- lease duration;
- renewal;
- clock assumptions;
- network partition behavior;
- holder pause behavior;
- expiry detection;
- fencing;
- release.

## 29.4 Prefer state-owner conditional writes when enough

Optimistic compare-and-set can be safer/simpler than a distributed lock for many update conflicts.

## 29.5 Leadership

If only one actor may coordinate a replicated system:

- use a mature consensus-backed leader mechanism;
- attach term/epoch to authority;
- reject stale leaders at write boundary where possible.

---

# 30. Consensus and replicated state machines

FLP proves that in a fully asynchronous system, deterministic consensus can have executions that do not terminate with even one faulty process. [FLP01]

Practical consensus protocols make additional timing/failure assumptions and provide safe progress conditions.

Raft is a widely studied replicated-log consensus algorithm that separates leader election, log replication and safety. [RAFT01]

## 30.1 Application rule

Most product teams SHOULD:

- consume a mature consensus-backed system;
- understand its guarantees/failure model;
- avoid implementing bespoke consensus.

## 30.2 If building coordination infrastructure

Require:

- explicit safety properties;
- liveness assumptions;
- membership-change semantics;
- persistent state;
- restart behavior;
- split-brain prevention;
- epoch/term handling;
- fault injection;
- preferably formal specification/model checking for critical properties.

---

# 31. Retry engineering

Retries improve apparent availability only under the right conditions.

Google SRE and Amazon operational guidance both document retry amplification and the role of exponential backoff/jitter. [RES01][RES02]

## 31.1 Retry decision record

```yaml
operation:
failure_conditions:
transient_conditions:
non_retryable_conditions:
ambiguous_outcome_behavior:
idempotency:
total_deadline:
per_attempt_timeout:
max_attempts:
max_retry_elapsed:
backoff:
jitter:
retry_after:
retry_owner:
overload_behavior:
metrics:
```

## 31.2 Ambiguous outcomes

Example:

```text
client sends charge
server commits charge
response lost
client sees timeout
```

The client cannot distinguish “not applied” from “applied but response lost.”

Options:

- idempotent retry with operation identity;
- query operation/status;
- reconcile;
- manual review.

Never assume timeout = rollback.

## 31.3 Retry locus

Prefer one layer that understands the business and remaining budget.

Lower-layer transparent retry MAY exist for connection setup or known safe semantics, but its attempt count and latency must remain compatible with end-to-end policy.

## 31.4 Exponential backoff + jitter

Use when clients can synchronize after shared failure.

Avoid exact synchronized schedules:

```text
1s, 2s, 4s, 8s
```

for thousands of clients without jitter.

## 31.5 Retry storms

During overload:

- fewer retries can improve total success;
- shed/reject;
- obey Retry-After;
- use retry budgets/token buckets;
- disable retries when dependency health shows they are harmful.

## 31.6 Retry-After

When HTTP service can tell clients when to retry, use protocol semantics where appropriate.

A client SHOULD still cap behavior by its own deadline and policy.

---

# 32. Deadlines, timeouts and cancellation

## 32.1 Total deadline

Start from end-to-end requirement:

```text
user budget = 2s
edge = 100ms
service work = 300ms
dependency = 900ms
reserve = 700ms
```

Do not independently give every hop 2 seconds.

## 32.2 Timeout categories

Distinguish:

- connection establishment;
- TLS/handshake;
- request headers;
- response headers;
- idle/read;
- total request;
- application operation.

Library “timeout” defaults differ; verify actual semantics.

## 32.3 False timeout

Too-short timeouts cause:
- retry amplification;
- duplicate work;
- false dependency failure;
- tail collapse.

Choose from measured latency distributions and consequence. [RES02]

## 32.4 Cancellation propagation

When client no longer wants result:

- signal cancellation;
- stop downstream work if safe;
- release resources;
- preserve integrity of partially committed work.

## 32.5 Deadline propagation

When crossing services, pass **remaining budget** rather than blindly reusing original duration.

---

# 33. Hedged/speculative requests

Hedging can reduce tail latency by starting an additional attempt before the first completes. The Tail at Scale documents such tail-mitigation mechanisms in large services. [TAIL01]

Classification: `CTX`.

Use only if:

- operation is read-only or duplicate-safe;
- tail latency materially dominates;
- capacity headroom exists;
- slower copies can be cancelled;
- duplicate load is measured.

Do not hedge an irreversible write by default.

---

# 34. Backpressure, admission and overload

Google SRE identifies overload as a mechanism for cascading failure: latency rises, in-flight work accumulates, queues grow and retries add load. [RES01]

## 34.1 Required workload model

```yaml
arrival_rate:
service_rate:
burst:
max_inflight:
queue_bound:
oldest_age_slo:
memory_per_item:
worker_count:
tenant_distribution:
retry_load:
downstream_capacity:
```

## 34.2 Queue bound

Bound by:
- count;
- bytes;
- age;
- storage quota;
- tenant quota.

An “unbounded” durable broker still has finite disk/time/business capacity.

## 34.3 Backpressure mechanisms

- pull-based consumption;
- explicit credits/window;
- producer throttling;
- 429/503 + Retry-After;
- concurrency semaphore;
- broker quotas;
- admission token;
- rejection/load shedding.

## 34.4 Load shedding

Protect the core outcome by dropping/rejecting lower-priority work before total saturation where permissible.

MUST NOT degrade:
- authorization;
- financial correctness;
- data integrity;
- safety controls.

## 34.5 Fairness

Multi-tenant systems SHOULD consider:

- per-tenant concurrency;
- quotas;
- weighted fairness;
- partition isolation;
- hot-key isolation.

## 34.6 Backlog recovery

A system that can handle steady state may fail during catch-up.

Test:
- consumer restart after long outage;
- peak backlog;
- replay while live traffic continues;
- downstream quota;
- autoscale lag;
- cache/DB pressure;
- poison messages.

---

# 35. Queue health and poison messages

## 35.1 Measure age and rate

Primary signals:

- incoming rate;
- successful processing rate;
- queue depth;
- oldest message age;
- lag/time behind source;
- retry rate;
- quarantine rate.

## 35.2 Poison classification

| Category | Typical action |
|---|---|
| transient dependency | bounded retry |
| rate/capacity | defer/backoff |
| invalid schema | quarantine + producer defect |
| invalid business state | quarantine/reconcile |
| unauthorized | reject/security signal |
| consumer code bug | stop/circuit/quarantine safely |
| oversized resource | reject/quarantine |
| irrecoverable external effect | manual repair/escalation |

## 35.3 Head-of-line blocking

If strict order is required, poison handling can block a key/partition.

Options:
- halt that key only;
- quarantine while recording gap;
- repair in place;
- route to ordered recovery lane.

Never skip silently if state transitions depend on sequence.

---

# 36. Dead-letter / quarantine standard

A DLQ is a **quarantine**, not successful handling.

Required for material systems:

```yaml
owner:
reason_taxonomy:
original_message_preserved:
source_position:
attempt_history:
first_failed_at:
last_failed_at:
contract_version:
consumer_version:
repair_method:
replay_method:
retention:
age_slo:
alert_threshold:
permanent_disposition:
```

Do not dump sensitive payloads into a broadly accessible DLQ.

---

# 37. Replay standard

Replay can re-execute business effects. Treat it as privileged.

## 37.1 Replay preflight

- define exact selection/range;
- estimate volume/cost;
- pin or transform schema/version;
- confirm idempotency;
- identify downstream side effects;
- isolate live traffic if needed;
- set rate/concurrency;
- define stop threshold;
- confirm audit/approver.

## 37.2 During replay

Observe:
- throughput;
- failure;
- duplicates;
- downstream saturation;
- business guardrails.

## 37.3 After replay

- reconcile expected vs actual;
- close quarantine items;
- record artifact versions;
- preserve audit trail.

---

# 38. External integration engineering

An external provider is an independently changing distributed system.

## 38.1 Integration record

```yaml
integration_id:
business_owner:
engineering_owner:
provider:
purpose:
criticality:

contract:
  api_versions:
  base_urls:
  schemas:
  auth:
  webhook:
  polling:

limits:
  requests:
  concurrency:
  payload:
  quotas:
  billing:

resilience:
  timeouts:
  retries:
  idempotency:
  outage_mode:
  status_page:
  support:

data:
  classifications:
  residency:
  retention:
  provider_ids:
  mapping:

reconciliation:
  source_of_truth:
  cadence:
  divergence_threshold:
  repair:

lifecycle:
  deprecation_watch:
  migration:
  exit:
```

## 38.2 Anti-corruption/adaptation layer

Use an adapter when:

- provider data model differs materially from domain;
- provider can be replaced;
- version churn is expected;
- provider errors/IDs leak excessive coupling.

Do not add an adapter that merely proxies every field without containing a change boundary.

## 38.3 Provider data validation

OWASP API10:2023 warns about unsafe consumption of APIs; integrated services should not be trusted more than other external inputs merely because they are partners. [OWASP01]

Validate:
- type/shape;
- size;
- URL/redirect behavior;
- identifiers;
- enum/default assumptions;
- authorization scope;
- data classification.

## 38.4 Provider outage modes

Choose:

- hard fail;
- queue for later;
- stale cache;
- manual path;
- partial feature;
- alternate provider;
- read-only.

Fallback complexity must earn its cost.

## 38.5 Sandbox parity

Test assumptions known to differ:
- auth;
- data volume;
- rate limits;
- webhooks;
- error codes;
- latency;
- eventual consistency;
- feature availability.

Production canary/limited exposure remains necessary when sandbox does not reproduce production behavior.

---

# 39. Reconciliation engineering

Reconciliation compares two representations of the same intended business reality and repairs divergence.

Use where:
- events/callbacks can be lost;
- external systems are authoritative;
- local projection is eventually consistent;
- financial/inventory/identity divergence is material.

## 39.1 Reconciliation record

```yaml
entity_scope:
source_of_truth:
local_representation:
comparison_key:
fields_or_invariants:
allowed_staleness:
cadence:
batching:
rate_limit:
difference_classes:
automatic_repairs:
manual_repairs:
audit:
```

## 39.2 Repair safety

Repairs SHOULD be:
- idempotent;
- bounded;
- auditable;
- dry-runnable where feasible;
- protected by current version/preconditions;
- reversible where feasible.

## 39.3 Do not overwrite blindly

A reconciler can destroy legitimate local state if ownership is unclear.

Repair only fields whose authority is defined.

---

# 40. API and integration inventory governance

OWASP API Security identifies improper inventory management as a significant risk category. [OWASP01]

Maintain enough inventory to know:

- what APIs/integrations exist;
- owners;
- public/internal scope;
- versions;
- auth;
- data classification;
- consumers/providers;
- criticality;
- last traffic/use;
- deprecation;
- unsupported endpoints.

Inventory is not a CMDB bureaucracy requirement. It is a change-impact and risk-control mechanism.

---

# 41. Versioning and compatibility

## 41.1 Version only when useful

Versioning mechanisms can include:
- URI;
- header/content negotiation;
- schema/document version;
- topic/event type version;
- package/protocol version.

No mechanism is universally best.

## 41.2 Compatibility dimensions

### Syntactic
Can old software parse it?

### Semantic
Does parsed data mean the same thing?

### Behavioral
Do side effects/errors/retries remain compatible?

### Operational
Do latency/rate/payload characteristics remain within assumptions?

### Security
Did required scope/authorization change?

### Ordering/consistency
Did visibility/sequence change?

A release can be syntax-compatible and still operationally breaking.

## 41.3 Expand → migrate → contract

For live systems:

```text
EXPAND
→ DEPLOY COMPATIBLE READERS
→ DEPLOY COMPATIBLE WRITERS
→ OBSERVE
→ MIGRATE DATA/CONSUMERS
→ STOP OLD WRITERS
→ STOP OLD READERS
→ CONTRACT
```

Exact order depends on change.

## 41.4 Unknown consumers

Public/event contracts may have consumers you cannot enumerate.

Use:
- explicit stability policy;
- telemetry where privacy/contracts permit;
- longer deprecation;
- opt-in new behavior;
- additive changes;
- release notes.

---

# 42. Deprecation and retirement

Every externally depended-on contract SHOULD define:

```yaml
deprecated_at:
replacement:
migration_guide:
support_until:
sunset_at:
usage_measurement:
owner:
communications:
removal_gate:
```

For HTTP, RFC 9745 `Deprecation` and RFC 8594 `Sunset` MAY convey machine-readable signals. [HTTP03][HTTP04]

Removal gate:
- supported consumers migrated;
- contractual window satisfied;
- traffic below threshold / explicitly accepted;
- rollback/recovery plan;
- monitoring during removal.

---

# 43. Security and trust-boundary baseline

Deep security belongs to Playbook 06. This section contains distributed-boundary invariants.

## 43.1 Authentication and authorization

Authentication:
> Who/what is the principal?

Authorization:
> May this principal perform this action on this resource in this context?

Do not use:
- network location;
- client-provided role;
- API route knowledge;
- trace ID;
- object ID possession

as authorization.

## 43.2 OAuth

Where OAuth 2.0 applies, RFC 9700 is the current Best Current Practice baseline at the evidence cutoff. [OAUTH01]

Do not implement OAuth security from memory; use maintained libraries and current BCP.

## 43.3 Message/webhook authenticity

Possible mechanisms:
- mutually authenticated transport;
- signed request;
- provider-specific HMAC;
- OAuth/access token;
- mTLS.

Select based on threat model/provider.

## 43.4 Replay protection

Authentication does not imply freshness.

Use as appropriate:
- event IDs;
- nonce;
- signed timestamp;
- expiration;
- idempotency;
- state version.

## 43.5 Resource consumption

Protect:
- payload size;
- decompression;
- query complexity;
- fan-out;
- connection count;
- concurrency;
- rate;
- stream duration.

## 43.6 Unsafe consumption

External API responses remain untrusted. [OWASP01]

---

# 44. Observability and traceability

## 44.1 Stable propagation

W3C Trace Context is a Recommendation defining standard HTTP trace-context propagation. [TRACE01]

Do not put sensitive business identity into trace headers unless explicitly designed and protected.

## 44.2 Async causality

For messages, preserve as useful:

- trace context;
- correlation ID;
- causation ID;
- event ID;
- workflow ID.

These are distinct.

```text
TRACE ID = diagnostic execution graph
CORRELATION ID = business/request grouping
CAUSATION ID = which prior action/event caused this
EVENT ID = unique event identity
```

## 44.3 Retry visibility

A request trace SHOULD make attempts visible rather than making three remote calls look like one unexplained slow call.

## 44.4 Messaging semantic conventions

OpenTelemetry messaging semantic conventions are `Development` at the evidence cutoff. [OTEL01]

Use them when useful but:
- pin versions;
- expect migration;
- do not make unstable field names a business contract.

## 44.5 Core distributed signals

### APIs
- request rate;
- success/error by stable category;
- latency percentiles;
- deadline exhaustion;
- retry attempts;
- 429/overload;
- version usage.

### Messaging
- produce success/latency;
- consumer success;
- lag;
- oldest age;
- attempts;
- duplicate detected;
- quarantine;
- replay;
- handler latency;
- rebalance/restart effect where relevant.

### Integrations
- provider latency/errors;
- quota;
- webhook age;
- missing callback/reconciliation difference;
- provider version;
- auth/token failure.

### Workflows
- in-progress count;
- age;
- failed step;
- compensation;
- manual recovery;
- terminal success.

---

# 45. Verification and validation strategy

Testing is selected from failure modes.

## 45.1 Contract tests

Test:
- valid examples;
- invalid inputs;
- optional/required;
- enum unknowns;
- null/missing;
- min/max;
- error schema;
- auth scopes.

## 45.2 Semantic tests

Test:
- units;
- state transitions;
- idempotency;
- retryability;
- freshness;
- ordering;
- default behavior;
- pagination.

## 45.3 Mixed-version compatibility

At minimum for material evolution:

```text
OLD PRODUCER → NEW CONSUMER
NEW PRODUCER → OLD CONSUMER
OLD CLIENT → NEW SERVER
NEW CLIENT → OLD SERVER
```

where supported coexistence requires it.

## 45.4 Failure injection

Inject:
- connection refused;
- connection reset;
- timeout before response;
- timeout after server commit;
- malformed response;
- partial response;
- dependency slowness;
- provider 429;
- provider 5xx;
- cancellation;
- duplicate message;
- reordered message;
- lost ack;
- consumer crash before ack;
- consumer crash after effect;
- broker unavailable;
- network partition where test environment permits;
- stale lock holder;
- clock skew where relevant.

## 45.5 Backlog/replay tests

Test:
- long consumer outage;
- maximum expected backlog;
- catch-up + live traffic;
- quarantine replay;
- rate-limited downstream;
- expired dedupe entries.

## 45.6 Property/state-machine testing

Useful for:
- idempotency state;
- workflow transitions;
- ordering/version rules;
- retry state;
- protocol handlers.

## 45.7 Formal methods

Use for scoped high-consequence distributed state-machine properties where the modeling cost is justified.

Potential targets:
- no double commit;
- only one valid leader epoch;
- no stale lock-holder write;
- workflow terminal-state invariants;
- transaction protocol safety.

Formal proof/model checking validates the model/property under assumptions; separately validate model fidelity.

---

# 46. Consumer/provider contract assurance

Consumer-driven contract testing is `CTX`.

Strong when:
- known consumers need rapid provider feedback;
- provider changes frequently;
- shared staging is expensive.

Limits:
- unknown consumers are absent;
- recorded examples may miss semantic edge cases;
- mocks can encode a wrong provider;
- operational properties are under-tested.

Combine with:
- canonical specification;
- provider implementation tests;
- integration tests;
- compatibility diff;
- mixed-version tests;
- staged release.

---

# 47. Chaos/failure testing

For critical distributed boundaries, controlled failure testing SHOULD exercise assumptions that are otherwise hypothetical.

Targets:
- latency;
- dependency loss;
- partition;
- broker loss;
- replica loss;
- queue saturation;
- expired credentials;
- DNS failure;
- provider throttling;
- clock/time-source issue where material.

Guardrails:
- blast radius;
- abort condition;
- owner;
- observation;
- recovery validation.

Chaos is not random destruction; it is hypothesis-driven resilience verification.

---

# 48. Operations standard

Production readiness for a material integration includes:

- contract owner;
- dependency owner;
- SLO/operational objective where material;
- timeout/retry/idempotency;
- capacity/quotas;
- dashboards;
- actionable alerts;
- reconciliation;
- replay;
- quarantine;
- provider escalation;
- deprecation watch;
- runbooks.

## 48.1 Runbook — ambiguous remote outcome

```text
1. Identify operation ID/idempotency key.
2. Determine whether remote side exposes authoritative status.
3. Query status before retrying an unsafe operation.
4. If state is unknown, block duplicate external effect.
5. Reconcile local/remote records.
6. Repair with audited idempotent action.
7. Record defect if contract cannot distinguish outcome safely.
```

## 48.2 Runbook — poison message

```text
1. Preserve original payload/metadata securely.
2. Classify deterministic vs transient.
3. Stop infinite retry.
4. Quarantine or isolate key/partition according to ordering invariant.
5. Identify producer/consumer contract version.
6. Repair code/data/schema.
7. Replay with bounds and idempotency.
8. Reconcile.
```

## 48.3 Runbook — provider outage

```text
1. Confirm scope/provider status.
2. Stop harmful retries.
3. Enable queue/degraded/manual path per contract.
4. Protect backlog capacity.
5. Communicate affected business capability.
6. On recovery, ramp gradually.
7. Reconcile missed state/callbacks.
8. Review retry/queue assumptions.
```

## 48.4 Runbook — backlog

```text
1. Measure age, rate, depth and downstream capacity.
2. Identify root cause: arrival spike, slow consumer, poison, dependency.
3. Stop retry amplification.
4. Prioritize critical work if allowed.
5. Add safe capacity or reduce intake.
6. Monitor catch-up rate and ETA internally.
7. Reconcile after drain.
8. Fix capacity/admission model.
```

---

# 49. Decision architecture

## 49.1 Boundary decision record

```yaml
decision:
business_outcome:
invariants:
state_owner:

alternatives:
  - direct_in_process
  - synchronous_remote
  - asynchronous_queue
  - pub_sub
  - durable_stream
  - external_provider

criteria:
  correctness:
  latency:
  availability:
  consistency:
  ordering:
  fanout:
  replay:
  scale:
  security:
  operability:
  compatibility:
  cost:

failure_modes:
tradeoffs:
selected:
rationale:
evidence:
revisit_trigger:
```

## 49.2 Prefer least irreversible adequate option

If multiple designs satisfy the contract, prefer:

- fewer failure domains;
- less hidden state;
- fewer independent retries;
- simpler repair;
- stronger observability;
- easier migration;
- lower operational dependency.

---

# 50. Decision trees

## 50.1 In-process vs remote

```text
Does capability need independent deployment/scaling/security/failure ownership?
  NO → keep in-process/module if architecture allows
  YES → distributed boundary may be justified
```

## 50.2 Sync vs async

```text
Must caller have result before continuing?
  YES → Can complete reliably inside total deadline?
           YES → synchronous candidate
           NO  → async operation/status workflow
  NO → Need buffering/fan-out/replay/independent consumption?
           YES → async candidate
           NO  → choose simpler interaction
```

## 50.3 HTTP resource vs RPC

```text
Is interaction naturally resource/state oriented and broadly interoperable?
  YES → HTTP resource API strong candidate
  NO  → Is typed procedure/streaming/internal service semantics dominant?
           YES → RPC/gRPC candidate
           NO  → choose clearest contract
```

## 50.4 GraphQL?

```text
Do clients materially need flexible selection/composition across a typed graph?
  NO → simpler HTTP/RPC often adequate
  YES → Can team enforce field auth, cost, resolver performance and schema governance?
           YES → GraphQL candidate
           NO  → avoid until controls exist
```

## 50.5 Queue vs stream

```text
Is each item primarily work for one logical worker group?
  YES → queue
  NO → Do independent consumers need retained history/positions/replay?
         YES → durable log/stream
         NO → pub/sub/direct event may be sufficient
```

## 50.6 Event vs command

```text
Is sender requesting a capability/action?
  YES → command
  NO → Is sender stating a completed domain fact?
         YES → event
         NO → clarify semantic intent
```

## 50.7 Notification vs event-carried state

```text
Should consumer fetch authoritative state?
  YES → notification can be small
  NO → Is reducing synchronous coupling worth duplicating more state?
         YES → event-carried state
         NO → keep contract smaller
```

## 50.8 Retry?

```text
Transient?
  NO → don't retry
  YES → safe to repeat / dedupe?
          NO → status/reconcile/idempotency first
          YES → budget remains and dependency not overloaded?
                  NO → fail/queue/reconcile
                  YES → bounded backoff+jitter retry
```

## 50.9 Idempotency required?

```text
Can same logical operation arrive/execute twice?
  NO → optional
  YES → Would duplicate effect be harmful?
          NO → natural duplicate tolerance may be enough
          YES → enforce logical operation identity + atomic duplicate safety
```

## 50.10 Distributed transaction vs saga

```text
Must all participants commit atomically with no visible intermediate state?
  YES → Can invariant be moved to one owner?
           YES → do that
           NO → evaluate supported atomic commit/coordination
  NO → Can intermediate states + compensation be correct?
           YES → durable saga/workflow
           NO → redesign invariant/boundary
```

## 50.11 Lock vs optimistic concurrency

```text
Can conflict be detected at authoritative state owner at commit time?
  YES → optimistic version/CAS often simpler
  NO → Must exclusive authority span external action?
          YES → lease/lock + fencing/epoch
          NO → reconsider coordination
```

## 50.12 Webhook vs polling

```text
Need low-latency external changes?
  YES → webhook if provider supports
Need correctness even if callback lost?
  YES → authoritative read/reconciliation too
```

## 50.13 Stronger consistency?

```text
What user/domain anomaly is unacceptable?
  → identify exact guarantee
Can session guarantee solve it?
  YES → use scoped guarantee
  NO → stronger transactional/linearizable coordination may be required
```

---

# 51. Pattern catalog — use contextually

## 51.1 API gateway

Useful for:
- routing;
- authentication enforcement;
- rate limiting;
- common protocol concerns.

Risk:
- central bottleneck;
- hidden business logic;
- policy drift.

## 51.2 Backend-for-Frontend

Useful when clients have materially different aggregation/workflow needs.

Risk:
- duplicated domain logic;
- extra hop.

## 51.3 Strangler migration

Useful for incremental integration replacement.

Requires:
- routing;
- data ownership;
- compatibility;
- reconciliation.

## 51.4 Transactional outbox

Useful for local state + publication intent atomicity.

Not end-to-end exactly-once.

## 51.5 Transactional inbox

Useful for local consume/effect dedupe atomicity.

## 51.6 Saga

Useful for long-running cross-boundary workflow with acceptable compensation.

## 51.7 Circuit breaker

Useful when repeated calls to unhealthy dependency should stop temporarily.

Risks:
- tuning/state complexity;
- synchronized recovery;
- masking slow degradation.

Not every dependency needs one.

## 51.8 Bulkhead

Useful to isolate tenant/dependency/workload resource pools.

Cost:
- reserved capacity;
- operational complexity.

## 51.9 Retry budget/token bucket

Useful to cap recovery traffic under widespread failure.

## 51.10 Rate limiter

Useful for fairness, abuse protection and capacity control.

Rate limiting is not capacity planning.

## 51.11 Event sourcing

Useful when the domain requires authoritative event history and state can be derived from it.

Costs:
- event immutability/evolution;
- replay;
- privacy deletion;
- projection correctness;
- operational complexity.

Do not adopt to “get an audit log” if a simpler audit log suffices.

## 51.12 CQRS

Useful when read/write models genuinely diverge.

Cost:
- projection lag;
- duplicated models;
- eventual consistency.

## 51.13 Change Data Capture

Useful for log-based propagation and legacy integration.

Do not confuse storage mutation with stable domain semantics.

## 51.14 Distributed cache

Useful for latency/load.

Must define:
- source of truth;
- staleness;
- invalidation;
- failure;
- tenant isolation.

## 51.15 Lease

Useful for time-bounded authority/liveness.

Needs stale-owner/fencing analysis.

## 51.16 Leader election

Useful when one coordinator is required.

Prefer mature consensus-backed implementation.

---

# 52. Failure-mode library

| Failure mode | Detection | Control |
|---|---|---|
| response lost after commit | timeout + status unknown | idempotency/status query/reconcile |
| duplicate request | same logical operation ID | atomic idempotency |
| duplicate message | repeated event ID | inbox/idempotent effect |
| reorder | version/sequence gap | key ordering/version guard/reconcile |
| missing event | reconciliation/sequence gap | replay/source query |
| poison message | repeat deterministic failure | quarantine/repair |
| backlog | age/lag rising | admission/scale/shedding |
| retry storm | attempt ratio rises | retry budget/backoff/jitter |
| hot key | skewed lag/CPU | partition strategy/per-key limit |
| stale lock holder | old epoch request | fencing |
| split brain | multiple authorities | consensus/epoch/resource rejection |
| stale read | version/freshness signal | stronger read/session routing |
| lost update | version mismatch | conditional write |
| dual-write gap | state but no event or inverse | outbox/transaction |
| saga stuck | workflow age | durable timer/escalation |
| failed compensation | compensation state | retry/manual repair |
| webhook loss | reconciliation difference | poll/source read |
| webhook replay | duplicate ID/freshness | signature + replay/idempotency |
| provider version break | contract rejects/errors | version watch/adapter |
| quota exhaustion | 429/quota metric | throttle/queue/schedule |
| trace break | orphan spans/correlation | context propagation |
| schema drift | compatibility test failure | expand/migrate/contract |
| unsafe replay | duplicate business effect | replay guard/idempotency |
| broker loss | produce/consume failure | availability design/recovery |
| clock skew | inconsistent timestamps | logical/version semantics |

---

# 53. Anti-patterns

## 53.1 “Exactly once” as an architecture checkbox

**Why it fails:** scope hidden.

**Better:** exactly-once scope matrix + external-effect analysis.

## 53.2 “Kafka/RabbitMQ means event-driven architecture”

**Why it fails:** broker choice does not define domain semantics.

**Better:** define commands/events, ownership, delivery and workflows first.

## 53.3 Retry all 5xx

**Why it fails:** overload/permanent failures can worsen.

**Better:** contract-specific retry eligibility + budget.

## 53.4 Timeout = failure

**Why it fails:** remote commit may have happened.

**Better:** ambiguous-outcome state.

## 53.5 Infinite queue = resilience

**Why it fails:** backlog becomes latency/storage collapse.

**Better:** bounded admission + age SLO.

## 53.6 DLQ = handled

**Why it fails:** data is merely moved.

**Better:** quarantine owner + repair + replay.

## 53.7 Timestamp = version

**Why it fails:** clock skew and causality.

**Better:** authoritative version/sequence.

## 53.8 Distributed lock = exclusivity forever

**Why it fails:** stale holder after lease expiry.

**Better:** fencing at protected resource.

## 53.9 Saga = rollback

**Why it fails:** compensation is observable and fallible.

**Better:** model compensating business actions.

## 53.10 Outbox = exactly once

**Why it fails:** relay/consumer duplicates remain.

**Better:** outbox + duplicate-safe consumer.

## 53.11 Schema passed = compatible

**Why it fails:** semantics/defaults/errors can break.

**Better:** semantic compatibility tests.

## 53.12 Events = decoupled

**Why it fails:** hidden schema/state/operational coupling.

**Better:** state coupling and consumer ownership analysis.

## 53.13 Global order “for safety”

**Why it fails:** creates unnecessary serialization.

**Better:** order only the entity/invariant that needs it.

## 53.14 Last-write-wins everywhere

**Why it fails:** silently discards legitimate concurrent intent.

**Better:** domain conflict policy.

## 53.15 Internal API = trusted API

**Why it fails:** bugs/compromise/ownership changes.

**Better:** validate and authorize at meaningful boundaries.

## 53.16 API version in URL = version strategy

**Why it fails:** coexistence/migration/removal still unsolved.

**Better:** explicit compatibility lifecycle.

## 53.17 Webhook = truth

**Why it fails:** callbacks can be lost/duplicated/delayed.

**Better:** callback + authoritative reconciliation.

## 53.18 Sandbox passed = integration ready

**Why it fails:** production scale/errors/quotas differ.

**Better:** bounded production validation.

## 53.19 Circuit breaker everywhere

**Why it fails:** state/tuning complexity without need.

**Better:** add only when repeated dependency calls create material failure amplification.

## 53.20 Microservice per domain noun

**Why it fails:** distributed boundaries added without independent value.

**Better:** service boundary must earn network/failure complexity.

## 53.21 Event sourcing for audit

**Why it fails:** vastly increases state/evolution/replay burden.

**Better:** use simpler append-only audit when authoritative event reconstruction is unnecessary.

## 53.22 Consumer contract mocks as truth

**Why it fails:** mocks can agree with consumers while provider differs.

**Better:** triangulate with provider/runtime evidence.

## 53.23 Reprocess until green

**Why it fails:** can duplicate irreversible side effects.

**Better:** classify failure, repair, bounded audited replay.

---

# 54. Plays

## PLAY-13-01 — Design a production API contract

### Objective
Release an interface whose success, failure and evolution semantics are explicit and testable.

### Trigger
New or materially changed API.

### Method
1. define business outcome/invariants;
2. identify state owner;
3. choose interaction style;
4. specify schema + semantics;
5. specify auth;
6. specify errors;
7. specify time/cancellation;
8. specify retry/idempotency;
9. specify concurrency/consistency;
10. specify limits;
11. specify compatibility/deprecation;
12. generate/maintain machine-readable contract;
13. test implementation conformance;
14. test mixed versions where material.

### Acceptance
- no material semantic dimension implicit;
- runtime conforms to contract;
- failure tests pass.

---

## PLAY-13-02 — Introduce an event/message

### Objective
Create an event contract safe for independent consumers.

### Steps
1. classify message type;
2. define fact/intent semantics;
3. name owner;
4. choose envelope;
5. define identity;
6. define schema;
7. define delivery;
8. define ordering;
9. define retention/replay;
10. define duplicate handling;
11. define compatibility;
12. define telemetry/quarantine;
13. test duplicate/reorder/replay.

### Acceptance
Consumer can act without relying on undocumented producer internals.

---

## PLAY-13-03 — Define a retry policy

### Objective
Recover transient faults without duplicate harm or outage amplification.

### Steps
1. define total deadline;
2. classify failures;
3. identify ambiguous outcome;
4. establish idempotency/status check;
5. select retry owner;
6. set attempts/time budget;
7. define backoff/jitter;
8. integrate Retry-After/provider policy;
9. define overload shutoff;
10. instrument attempts/success.

### Acceptance
Retry cannot exceed total budget or bypass duplicate safety.

---

## PLAY-13-04 — Make an operation idempotent

### Objective
Prevent duplicate logical operation from causing additional unintended effect.

### Steps
1. define logical identity;
2. define principal/tenant scope;
3. define request fingerprint;
4. atomically reserve key;
5. define IN_PROGRESS handling;
6. persist effect + completion coherently;
7. replay outcome;
8. define retention;
9. race-test concurrent duplicates;
10. replay-test after restart.

---

## PLAY-13-05 — Integrate a third-party provider

### Objective
Build an integration that survives provider failure/change and can reconcile state.

### Steps
1. inventory authoritative docs/version;
2. define local domain adapter;
3. map data authority;
4. secure auth/secrets;
5. validate provider input;
6. define timeout/retry/idempotency;
7. map rate/quota;
8. implement webhook/polling;
9. add reconciliation;
10. add provider outage mode;
11. add telemetry/support path;
12. test production-like failure;
13. register deprecation watch/exit.

---

## PLAY-13-06 — Evolve a live contract

### Objective
Change behavior without silently breaking supported consumers.

### Steps
1. identify consumers/versions;
2. classify syntax/semantic/operational change;
3. design expand path;
4. deploy compatible reader;
5. deploy compatible writer;
6. test old/new combinations;
7. observe migration;
8. communicate deprecation;
9. remove only after gate;
10. regression-test.

---

## PLAY-13-07 — Recover a poison message

### Objective
Restore progress without losing ordering/integrity.

### Steps
1. classify failure;
2. stop infinite retry;
3. preserve evidence;
4. determine ordering effect;
5. quarantine/isolate;
6. repair producer/consumer/data;
7. verify idempotency;
8. replay bounded;
9. reconcile;
10. close defect/root cause.

---

## PLAY-13-08 — Reconcile distributed state

### Objective
Detect and repair divergence between authoritative and derived/external state.

### Steps
1. define authority per field;
2. select comparison keys;
3. scan bounded scope;
4. classify differences;
5. auto-repair only unambiguous cases;
6. route ambiguous cases;
7. apply version-safe repair;
8. re-check;
9. record metrics;
10. correct root propagation issue.

---

## PLAY-13-09 — Introduce a queue/broker

### Objective
Adopt messaging only when it solves a measured requirement and with bounded failure semantics.

### Steps
1. define why async is required;
2. choose queue/pubsub/log semantics;
3. define retention;
4. define delivery/ack;
5. define ordering/partition key;
6. define duplicates;
7. define queue/in-flight bounds;
8. define retry/quarantine;
9. define replay;
10. define observability;
11. test outage/backlog;
12. document broker exit/migration.

---

## PLAY-13-10 — Design a distributed workflow

### Objective
Coordinate cross-boundary business outcome with recoverable state.

### Steps
1. define outcome/invariant;
2. list steps/owners;
3. classify reversibility;
4. decide orchestration/choreography;
5. persist workflow state;
6. set operation IDs/idempotency;
7. define per-step deadlines/retries;
8. define compensation;
9. define manual recovery;
10. test crash after every step boundary;
11. test compensation failures;
12. add workflow age alerts.

---

# 55. Review checklists

## 55.1 API contract review

- [ ] business outcome/invariant explicit
- [ ] state owner named
- [ ] schema canonical
- [ ] semantic validation explicit
- [ ] auth/authz explicit
- [ ] errors stable/actionable
- [ ] deadline/cancellation explicit
- [ ] retry semantics explicit
- [ ] idempotency explicit
- [ ] concurrency/preconditions explicit
- [ ] consistency/freshness explicit
- [ ] rate/payload/concurrency limits explicit
- [ ] pagination/batching explicit
- [ ] compatibility/deprecation explicit
- [ ] implementation conformance tested
- [ ] old/new coexistence tested where needed

## 55.2 Event/messaging review

- [ ] command/event/state-transfer/CDC class explicit
- [ ] event identity stable
- [ ] producer/consumer owners known
- [ ] delivery boundary specified
- [ ] ack point specified
- [ ] duplicate behavior tested
- [ ] ordering scope/key specified
- [ ] late/gap behavior specified
- [ ] retention/replay specified
- [ ] queue/lag bound specified
- [ ] quarantine owner specified
- [ ] schema + semantic compatibility tested
- [ ] replay does not duplicate unsafe effects

## 55.3 Retry review

- [ ] transient conditions justified
- [ ] permanent conditions excluded
- [ ] ambiguous outcome handled
- [ ] safe repeat/idempotency proven
- [ ] total deadline set
- [ ] retry owner known
- [ ] attempt budget bounded
- [ ] backoff/jitter used when correlation possible
- [ ] overload behavior defined
- [ ] attempts observable

## 55.4 External provider review

- [ ] current provider docs/version verified
- [ ] provider input treated untrusted
- [ ] auth/secret rotation owned
- [ ] quotas/rates monitored
- [ ] sandbox gaps known
- [ ] timeout/retry/idempotency aligned
- [ ] callback signature/replay handling
- [ ] reconciliation exists if consequential
- [ ] degraded/outage mode defined
- [ ] support/status path known
- [ ] deprecation watch exists
- [ ] exit/data portability considered

## 55.5 Distributed coordination review

- [ ] invariant requiring coordination explicit
- [ ] simpler conditional-write option considered
- [ ] lease/lock expiry semantics understood
- [ ] stale holder prevented with fencing where needed
- [ ] consensus service mature
- [ ] epoch/term propagated
- [ ] split-brain scenario tested
- [ ] recovery/membership change understood

---

# 56. Production readiness gate

A material distributed boundary MAY be released only when applicable:

## Correctness
- [ ] invariants explicit
- [ ] state ownership explicit
- [ ] duplicate/reorder behavior correct
- [ ] consistency contract correct

## Failure
- [ ] partial failure modeled
- [ ] ambiguous outcome handled
- [ ] timeouts/deadlines tested
- [ ] retry budget tested
- [ ] cancellation tested

## Capacity
- [ ] load assumptions tested
- [ ] queue/in-flight bounded
- [ ] overload behavior tested
- [ ] backlog recovery tested

## Evolution
- [ ] contract version/status controlled
- [ ] mixed-version compatibility tested
- [ ] migration/deprecation plan exists

## Operations
- [ ] dashboards/signals exist
- [ ] replay/quarantine controlled
- [ ] reconciliation exists where needed
- [ ] runbooks exist
- [ ] owner/support escalation exists

## Security
- [ ] trust boundary reviewed
- [ ] auth/authz enforced
- [ ] inputs bounded/validated
- [ ] replay/resource-abuse considered

No unresolved BLOCKER defects.

---

# 57. Metrics

Measure distributed-system outcomes, not architecture activity.

## 57.1 API

- success rate by business operation;
- latency percentile;
- timeout/deadline rate;
- retry amplification ratio;
- idempotency duplicate rate;
- precondition/conflict rate;
- 429/load-shed rate;
- deprecated-version traffic;
- contract reject rate.

## 57.2 Messaging

- publish success;
- end-to-end event age;
- consumer lag;
- oldest queued age;
- handler latency;
- redelivery;
- duplicate detected;
- quarantine;
- replay;
- poison cause;
- backlog recovery rate.

## 57.3 Workflow

- completion rate;
- age to terminal state;
- retries per step;
- compensations;
- failed compensations;
- manual recovery;
- orphan/stuck workflows.

## 57.4 Integration

- provider availability as observed;
- provider latency;
- rate/quota headroom;
- callback delay;
- reconciliation divergence;
- missing/duplicate provider events;
- provider contract/version errors.

## 57.5 Metric integrity

For every important metric define:

```yaml
decision:
population:
source:
owner:
cadence:
threshold:
known_gaming_or_blind_spot:
```

---

# 58. AI/agent integration overlay

AI agents often interact through tools/APIs and can repeat, parallelize or chain actions unpredictably.

Therefore agent tool contracts SHOULD additionally define:

- action side-effect class;
- idempotency key generation;
- maximum concurrency;
- retry policy outside model discretion;
- authorization outside prompt;
- approval thresholds;
- result schema;
- provenance;
- stop/revoke;
- reconciliation.

An agent saying “I already did this” is not evidence of committed external state. Query/verify the authoritative system.

For autonomous high-impact workflows:

```text
MODEL INTENT
→ POLICY / AUTHORIZATION
→ IDEMPOTENT TOOL CONTRACT
→ EXECUTION
→ VERIFIED RESULT
→ AUDIT / RECONCILIATION
```

---

# 59. One-page Golden Standard

If only one section is used:

1. Start with the business invariant, not REST/Kafka/GraphQL/gRPC.
2. Name the authoritative state owner.
3. Treat every remote boundary as independently fallible.
4. Define contract semantics beyond schema: errors, time, repeat, ordering, consistency, limits and evolution.
5. Give remote work a finite deadline or abandonment policy.
6. Timeout does not prove non-application.
7. Propagate cancellation where useful and safe.
8. Retry only plausible transient failure that is safe to repeat and within budget.
9. Choose one effective retry locus; prevent multiplicative retries.
10. Use backoff/jitter when clients can synchronize.
11. If harmful duplicates are plausible, enforce logical-operation idempotency or equivalent duplicate safety.
12. Make idempotency atomic under concurrent duplicates.
13. Do not claim a current IETF-standard `Idempotency-Key` header; the draft is expired at this cutoff.
14. Scope every at-most/at-least/exactly-once claim to the actual boundary.
15. Exactly-once broker processing does not automatically include external side effects.
16. Define acknowledgement/offset point deliberately.
17. Classify messages: command, notification, state transfer, integration event, CDC or snapshot.
18. Give events owners and compatibility policies.
19. State ordering scope and key; do not assume global order.
20. Delivery order is not necessarily completion order.
21. Do not infer causality from wall-clock timestamps.
22. Define behavior for gaps, late events and duplicates.
23. Select consistency from the user/business contract.
24. Treat read-your-writes and monotonic reads as first-class session guarantees when needed.
25. Do not use CAP as “pick any two”; define partition behavior per operation.
26. Keep atomic invariants inside one transactional owner where practical.
27. Use 2PC only when real atomic cross-participant commit is required and supported.
28. Saga compensation is a fallible forward action, not rollback.
29. Persist long-running workflow state.
30. Outbox closes a local dual-write gap; it does not create end-to-end exactly-once.
31. Distributed locks require stale-holder reasoning; use fencing/epochs where harmful stale action is possible.
32. Prefer mature consensus/coordination mechanisms over bespoke algorithms.
33. Bound queues and in-flight work.
34. Measure queue age/lag, not only depth.
35. Propagate backpressure; shed/reject before saturation where acceptable.
36. Treat provider responses and callbacks as untrusted.
37. Webhook authenticity, replay protection and idempotency are separate controls.
38. Consequential external state needs reconciliation.
39. Schema compatibility is not semantic compatibility.
40. Test old/new producer/consumer combinations where they coexist.
41. Deprecate with replacement, migration, telemetry/support window and removal gate.
42. Observe retries, duplicates, timeouts, lag, replay and reconciliation—not only request success.
43. DLQ is quarantine requiring an owner and repair path.
44. Replay is a privileged production mutation.
45. Prefer the least distributed design that demonstrably satisfies requirements.

---

# 60. Templates

## 60.1 Distributed interaction specification

```yaml
id:
owner:
outcome:
invariants:

boundary:
  caller:
  callee:
  protocol:

state:
  source_of_truth:
  writers:
  readers:

contract:
  input:
  output:
  semantic_validation:
  errors:
  preconditions:
  postconditions:

time:
  deadline:
  timeout:
  cancellation:

delivery:
  scope:
  ack_point:
  duplicate:
  loss:
  replay:

idempotency:
  logical_id:
  atomic_claim:
  retention:

ordering:
  required:
  key:
  scope:
  gap:
  late:

consistency:
  guarantees:
  session:
  conflicts:

capacity:
  rate:
  concurrency:
  queue:
  backpressure:
  overload:

recovery:
  retry:
  compensation:
  reconcile:
  replay:
  quarantine:

evolution:
  compatibility:
  version:
  deprecation:

observability:
  correlation:
  metrics:
  logs:
  traces:
```

## 60.2 Event contract

```yaml
event_type:
meaning:
owner:
source:
subject:
identity:
occurred_at_semantics:
payload_schema:
schema_version:
delivery_scope:
ordering_key:
retention:
replay:
duplicate_handling:
compatibility:
privacy:
consumers:
```

## 60.3 Retry policy

```yaml
operation:
total_deadline:
attempt_timeout:
retry_owner:
max_attempts:
max_elapsed:
retryable:
non_retryable:
ambiguous_outcome:
idempotency:
backoff:
jitter:
retry_after:
overload_cutoff:
metrics:
```

## 60.4 Idempotency contract

```yaml
logical_operation:
key:
scope:
principal:
fingerprint:
atomic_claim:
in_progress_response:
success_response_replay:
failure_policy:
retention:
expiry:
concurrent_duplicate_test:
```

## 60.5 Reconciliation plan

```yaml
scope:
authoritative_system:
derived_system:
identity_mapping:
allowed_staleness:
comparison:
cadence:
rate_limit:
difference_classes:
auto_repair:
manual_repair:
audit:
post_repair_verification:
```

---

# 61. Evidence map and source register

> Sources have different roles. Protocol specifications define protocol semantics; research establishes models/limits; vendor/platform docs establish scoped implementation behavior; operational guides provide production mechanisms. No source is treated as proof of a universal implementation choice.

## BASE01 — Master Playbook Standard 2.0-RC1
**Source:** uploaded project artifact.  
**Role:** evidence model, risk/rigor, falsification, play architecture, QA, traceability, lifecycle.  
**Limitation:** house standard; not an external certification.

## BASE02 — Universal Software & AI Engineering Master Playbook 2.0
**Source:** uploaded project artifact.  
**Role:** parent engineering doctrine for contracts, ordering, retries, bounded work, failure, compatibility and specialist-playbook delegation.  
**Limitation:** universal layer intentionally delegates implementation depth to this playbook.

## HTTP01 — IETF RFC 9110 — HTTP Semantics
**URL:** https://www.rfc-editor.org/rfc/rfc9110.html  
**Evidence:** Internet Standards Track protocol semantics.  
**Used for:** safe/idempotent methods, Retry-After and HTTP behavior.  
**Limitation:** HTTP method semantics do not define end-to-end business idempotency.

## HTTP02 — IETF RFC 9457 — Problem Details for HTTP APIs
**URL:** https://www.rfc-editor.org/rfc/rfc9457.html  
**Evidence:** Internet Standards Track.  
**Used for:** machine-readable HTTP problem details; obsoletes RFC 7807.  
**Limitation:** not a universal domain error taxonomy.

## HTTP03 — IETF RFC 9745 — Deprecation HTTP Response Header Field
**URL:** https://www.rfc-editor.org/rfc/rfc9745.html  
**Evidence:** published RFC.  
**Used for:** HTTP deprecation signaling.  
**Limitation:** signaling does not perform migration.

## HTTP04 — IETF RFC 8594 — Sunset HTTP Header Field
**URL:** https://www.rfc-editor.org/rfc/rfc8594.html  
**Evidence:** IETF Informational RFC.  
**Used for:** expected unavailability/sunset signaling.  
**Limitation:** clients treat as advisory information; migration governance still required.

## RATE01 — IETF RFC 6585 — Additional HTTP Status Codes
**URL:** https://www.rfc-editor.org/rfc/rfc6585.html  
**Evidence:** Standards Track.  
**Used for:** 428 Precondition Required and 429 Too Many Requests.  
**Limitation:** does not define complete quota policy.

## RATEDRAFT01 — IETF HTTPAPI — RateLimit header fields for HTTP, draft-11
**URL:** https://datatracker.ietf.org/doc/draft-ietf-httpapi-ratelimit-headers/  
**Status at cutoff:** Active Internet-Draft; not final RFC.  
**Used for:** watch item/current direction only.  
**Rule:** MUST NOT be represented as a final standard.

## IDEMPDRAFT01 — IETF HTTPAPI — Idempotency-Key HTTP Header Field draft-07
**URL:** https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/  
**Status at cutoff:** Expired and archived Internet-Draft.  
**Used for:** status/falsification evidence; pattern history only.  
**Rule:** MUST NOT be represented as a current final IETF standard.

## OAS01 — OpenAPI Specification 3.2.1
**URL:** https://spec.openapis.org/oas/v3.2.1.html  
**Published:** 10 September 2026.  
**Used for:** current standard language-agnostic HTTP API description.  
**Limitation:** description does not prove deployed runtime conformance or semantic compatibility.

## JSON01 — JSON Schema Draft 2020-12
**URL:** https://json-schema.org/specification  
**Status:** current version identified by official project at cutoff.  
**Used for:** JSON structure/validation.  
**Limitation:** schema validation is not full business-semantic validation.

## GQL01 — GraphQL Specification
**URL:** https://spec.graphql.org/  
**Status at cutoff:** September 2025 latest released specification; 17 September 2026 working draft is prerelease.  
**Used for:** GraphQL normative semantics.  
**Limitation:** operational complexity, auth and resolver performance remain implementation concerns.

## GRPC01 — gRPC — Deadlines
**URL:** https://grpc.io/docs/guides/deadlines/  
**Evidence:** official platform documentation.  
**Used for:** explicit deadline importance and cancellation behavior.  
**Limitation:** gRPC-specific APIs; end-to-end deadline principle generalizes.

## GRPC02 — gRPC — Retry
**URL:** https://grpc.io/docs/guides/retry/  
**Evidence:** official platform documentation.  
**Used for:** configured retry behavior, backoff/attempt monitoring.  
**Limitation:** application owns side-effect safety.

## ASYNC01 — AsyncAPI Specification 3.1.0
**URL:** https://www.asyncapi.com/docs/reference/specification/v3.1.0  
**Released:** 31 January 2026.  
**Used for:** protocol-agnostic message-driven API description.  
**Limitation:** does not define actual broker delivery/ordering/runtime behavior.

## CE01 — CloudEvents Specification 1.0.2
**URL:** https://github.com/cloudevents/spec  
**Status:** latest stable core version listed as 1.0.2 at cutoff.  
**Used for:** event envelope portability.  
**Limitation:** does not define domain event semantics or business idempotency.

## AMQP01 — OASIS AMQP 1.0
**URL:** https://www.oasis-open.org/standard/amqp/  
**Status:** OASIS Standard; also ISO/IEC 19464:2014.  
**Used for:** standardized messaging protocol example.  
**Limitation:** using AMQP does not define application delivery semantics automatically.

## MQTT01 — OASIS MQTT 5.0
**URL:** https://docs.oasis-open.org/mqtt/mqtt/v5.0/mqtt-v5.0.html  
**Status:** OASIS Standard, 2019.  
**Used for:** publish/subscribe/QoS protocol example.  
**Limitation:** protocol QoS does not equal exactly-once business side effect.

## WS01 — IETF RFC 6455 — The WebSocket Protocol
**URL:** https://www.rfc-editor.org/info/rfc6455/  
**Evidence:** Standards Track with subsequent updates.  
**Used for:** bidirectional long-lived WebSocket baseline.  
**Limitation:** application reconnection/resume/business semantics remain separate.

## DIST01 — Lamport — Time, Clocks, and the Ordering of Events in a Distributed System
**URL:** https://www.microsoft.com/en-us/research/publication/time-clocks-ordering-events-distributed-system/  
**Evidence:** foundational peer-reviewed distributed-systems research.  
**Used for:** happened-before, logical/causal ordering.  
**Limitation:** modern platforms may offer stronger scoped guarantees; inspect their contracts.

## CONS01 — Herlihy & Wing — Linearizability
**URL:** https://doi.org/10.1145/78969.78972  
**Evidence:** foundational peer-reviewed concurrency research.  
**Used for:** definition/meaning of linearizability.  
**Limitation:** one consistency condition; not universally required.

## CONS02 — Terry et al. — Session Guarantees for Weakly Consistent Replicated Data
**URL:** https://ieeexplore.ieee.org/document/331722/  
**Evidence:** peer-reviewed distributed-systems research.  
**Used for:** read-your-writes, monotonic reads, writes-follow-reads, monotonic writes.  
**Limitation:** does not define all possible consistency models.

## CAP01 — Gilbert & Lynch — Brewer’s Conjecture and the Feasibility of Consistent, Available, Partition-Tolerant Web Services
**URL:** https://doi.org/10.1145/564585.564601  
**Evidence:** formal distributed-systems result.  
**Used for:** partition consistency/availability impossibility under stated model.  
**Limitation:** frequently overgeneralized beyond its definitions/model.

## CAP02 — Brewer — CAP Twelve Years Later: How the “Rules” Have Changed
**URL:** https://doi.org/10.1109/MC.2012.37  
**Evidence:** authoritative retrospective/clarification.  
**Used for:** rejecting simplistic permanent “pick two” framing.  
**Limitation:** explanatory article, not a full design method.

## FLP01 — Fischer, Lynch & Paterson — Impossibility of Distributed Consensus with One Faulty Process
**URL:** https://doi.org/10.1145/3149.214121  
**Evidence:** foundational peer-reviewed impossibility result.  
**Used for:** limits of deterministic consensus in asynchronous model.  
**Limitation:** practical systems add timing/failure assumptions.

## RAFT01 — Ongaro & Ousterhout — In Search of an Understandable Consensus Algorithm
**URL:** https://www.usenix.org/conference/atc14/technical-sessions/presentation/ongaro  
**Evidence:** peer-reviewed systems research.  
**Used for:** practical replicated-log consensus structure.  
**Limitation:** one consensus algorithm, not a mandate to use Raft.

## TX01 — Gray & Lamport — Consensus on Transaction Commit
**URL:** https://www.microsoft.com/en-us/research/publication/consensus-on-transaction-commit/  
**Evidence:** peer-reviewed database/distributed-systems research.  
**Used for:** 2PC blocking characteristics and fault-tolerant commit comparison.  
**Limitation:** implementation/runtime choices remain contextual.

## SAGA01 — Garcia-Molina & Salem — Sagas
**URL:** https://www.cs.princeton.edu/research/techreps/598  
**Evidence:** foundational database research.  
**Used for:** decomposed long-running transactions and compensations.  
**Limitation:** modern service workflows add operational/security concerns beyond original model.

## LOCK01 — Burrows — The Chubby Lock Service for Loosely-Coupled Distributed Systems
**URL:** https://research.google/pubs/the-chubby-lock-service-for-loosely-coupled-distributed-systems/  
**Evidence:** peer-reviewed production systems paper.  
**Used for:** distributed locking, leases, sequencers/fencing concepts.  
**Limitation:** Google-specific lock service and scale.

## SPAN01 — Corbett et al. — Spanner
**URL:** https://research.google/pubs/spanner-googles-globally-distributed-database/  
**Evidence:** peer-reviewed large-scale distributed database paper.  
**Used for:** example of externally consistent transactions requiring explicit clock-uncertainty machinery.  
**Limitation:** not evidence every system should implement TrueTime-like infrastructure.

## TAIL01 — Dean & Barroso — The Tail at Scale
**URL:** https://research.google/pubs/the-tail-at-scale/  
**Evidence:** peer-reviewed/large-scale operational systems evidence.  
**Used for:** tail-latency mitigation and hedging context.  
**Limitation:** hyperscale latency techniques can add unnecessary load/complexity elsewhere.

## RES01 — Google SRE — Addressing Cascading Failures
**URL:** https://sre.google/sre-book/addressing-cascading-failures/  
**Evidence:** mature large-scale operational guidance.  
**Used for:** overload, retry amplification, backoff/jitter, load shedding.  
**Limitation:** implementation depth should scale to workload.

## RES02 — AWS — Timeouts, retries, and backoff with jitter
**URL:** https://builder.aws.com/content/3EumjoZascWd1oZiEgL8ORlv3qE/timeouts-retries-and-backoff-with-jitter  
**Status:** current AWS Builder Center publication, June 2026.  
**Used for:** remote timeout, retry/backoff/jitter operational mechanisms.  
**Limitation:** Amazon practice; principles require local measurement.

## IDP01 — AWS Builders’ Library — Making retries safe with idempotent APIs
**URL:** https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/  
**Evidence:** mature operational design pattern.  
**Used for:** idempotent API request identity and retry safety.  
**Limitation:** not an Internet standard and complexity is not justified for every operation.

## KAFKA01 — Apache Kafka 4.3 Design — Message Delivery Semantics
**URL:** https://kafka.apache.org/43/design/design/  
**Evidence:** current official platform documentation.  
**Used for:** scoped example of at-most/at-least/exactly-once and external-destination limits.  
**Limitation:** Kafka-specific; not a universal broker contract.

## TRACE01 — W3C Trace Context
**URL:** https://www.w3.org/TR/trace-context/  
**Status:** W3C Recommendation, 23 November 2021.  
**Used for:** interoperable HTTP trace context.  
**Limitation:** trace propagation does not define business correlation/identity.

## OTEL01 — OpenTelemetry Messaging Semantic Conventions
**URL:** https://opentelemetry.io/docs/specs/semconv/messaging/  
**Status at cutoff:** Development.  
**Used for:** implementation guidance/watch item.  
**Rule:** field conventions SHOULD be version-aware; MUST NOT be misrepresented as stable final semantics while marked Development.

## OAUTH01 — IETF RFC 9700 — Best Current Practice for OAuth 2.0 Security
**URL:** https://www.rfc-editor.org/info/rfc9700/  
**Status:** BCP 240, published 2025.  
**Used for:** current OAuth 2.0 security baseline.  
**Limitation:** applies when OAuth is the chosen authorization framework.

## SIG01 — IETF RFC 9421 — HTTP Message Signatures
**URL:** https://www.rfc-editor.org/rfc/rfc9421.html  
**Evidence:** Internet Standards Track.  
**Used for:** HTTP message integrity/authenticity building block.  
**Limitation:** explicitly not a complete application-security solution.

## OWASP01 — OWASP API Security Top 10 2023
**URL:** https://owasp.org/projects/api-security-project  
**Status:** current edition found at cutoff.  
**Used for:** risk-awareness, particularly authorization, resource consumption, inventory and unsafe API consumption.  
**Limitation:** awareness list, not a complete security verification standard.

---

# 62. Falsification trace — V1 → V2

| V1 weakness | V2 correction |
|---|---|
| exactly-once warning too compact | layered scope matrix + prohibited unsuffixed claim |
| idempotency concurrency race | atomic key state machine |
| IETF Idempotency-Key status ambiguous | explicitly expired draft |
| rate-limit field status ambiguous | active draft only; 429/Retry-After published baseline |
| CAP risk of pick-two shorthand | operation/partition behavior model |
| “weakest consistency” wording | least coordination-intensive model satisfying full user/business contract |
| session guarantees secondary | first-class API/UX consistency |
| timeout vs cancellation | separate total deadline/attempt timeout/cancellation |
| retry rule not enough | retry locus + budget + overload cutoff |
| locks/leases | fencing/epoch/resource-side validation |
| saga rollback misconception | compensation step classification |
| outbox overclaim risk | local dual-write gap only |
| DLQ afterthought | quarantine standard + runbook |
| replay under-controlled | privileged mutation standard |
| queue depth focus | age/lag/rate/fairness |
| webhook reliability | durable accept + dedupe + reconciliation |
| event taxonomy limited | command/notification/state transfer/integration/CDC/snapshot |
| compatibility mostly schema | semantic/behavioral/operational/security/order dimensions |
| OTel messaging treated too steadily | marked Development |
| contract artifacts may drift | runtime conformance release gate |
| third-party trust | explicit unsafe-consumption control |

---

# 63. Definition of Done for this playbook release

## Research
- [x] parent standards incorporated
- [x] primary protocol/specification sources checked
- [x] current spec status checked at cutoff
- [x] foundational distributed-systems literature included
- [x] mature operational evidence included
- [x] contradiction/falsification pass completed
- [x] drafts distinguished from final standards

## Content
- [x] contracts
- [x] HTTP APIs
- [x] RPC/gRPC
- [x] GraphQL
- [x] webhooks/polling
- [x] events/messaging
- [x] delivery semantics
- [x] retries/deadlines
- [x] idempotency/deduplication
- [x] ordering/causality/time
- [x] consistency/CAP
- [x] transactions/sagas/outbox
- [x] locks/leases/fencing/consensus
- [x] backpressure/overload
- [x] external integrations
- [x] compatibility/deprecation
- [x] observability
- [x] verification
- [x] replay/reconciliation/DLQ
- [x] patterns/anti-patterns
- [x] decision trees
- [x] plays/checklists/templates
- [x] evidence map

## Remaining validation before `VALIDATED`
- [ ] named accountable owner
- [ ] non-author execution on a real HTTP API design
- [ ] non-author execution on an event-driven workflow
- [ ] failure-injection exercise on retry/idempotency/replay
- [ ] independent distributed-systems/security review for one R3 application
- [ ] field feedback after real integration use
- [ ] regression update after defects discovered in those tests

---

# 64. Change log

## 2.0 — 2026-09-27 — Golden Master / REVIEWED

- rebuilt from V1 after falsification audit;
- current OpenAPI baseline set to 3.2.1;
- current AsyncAPI baseline set to 3.1.0;
- GraphQL release vs working draft separated;
- JSON Schema current status verified;
- CloudEvents stable baseline verified;
- expired Idempotency-Key Internet-Draft explicitly downgraded;
- active RateLimit Internet-Draft explicitly labeled non-final;
- exactly-once scope model added;
- session consistency added;
- CAP framing corrected;
- idempotency concurrency state machine added;
- stale-lock fencing strengthened;
- timeout/cancellation separation added;
- retry budget/locus/overload rules strengthened;
- replay/quarantine/reconciliation made first-class;
- semantic compatibility matrix added;
- event taxonomy expanded;
- external integration lifecycle strengthened;
- source register expanded and version-status audited.

## 1.0 — 2026-09-27 — DRAFT_RESEARCH_SYNTHESIS

- initial specialist playbook synthesis from Playbook 00 and Universal Software & AI Engineering Master Playbook;
- proceeded to formal falsification before release.

## 64.1 Mechanical release audit

The final V2 artifact passed a deterministic integrity check after synthesis and cleanup:

```text
40 evidence IDs used
40 evidence IDs defined
0 missing evidence definitions
0 dead evidence definitions
138 Markdown code-fence markers; balanced = yes
0 unresolved temporary-marker tokens
```

This check verifies document integrity only; it does not substitute for the non-author and field validation still required before `VALIDATED`.

---

# 65. Final doctrine

Distributed-systems quality is not produced by choosing prestigious technologies or adding more middleware.

It is produced by making the important truths explicit:

```text
WHO OWNS THE STATE?
WHAT MUST REMAIN TRUE?
WHAT DOES THE CONTRACT PROMISE?
WHAT IF THE OTHER SIDE IS SLOW OR GONE?
WHAT IF THE OUTCOME IS UNKNOWN?
WHAT IF THE REQUEST HAPPENS TWICE?
WHAT IF MESSAGES ARRIVE OUT OF ORDER?
WHAT IF TWO WRITERS DISAGREE?
WHAT IF A LEASE HOLDER COMES BACK FROM THE DEAD?
WHAT IF THE QUEUE GROWS FASTER THAN IT DRAINS?
WHAT IF OLD AND NEW VERSIONS RUN TOGETHER?
WHAT IF THE CALLBACK NEVER ARRIVES?
HOW DO WE PROVE, OBSERVE, RECONCILE AND REPAIR?
```

The evergreen standard is therefore:

> **Define the invariant and state owner; make the full boundary contract explicit; assume delay, duplication, reordering, partial failure and change; bound time and work; make repetition safe; scope ordering and consistency; protect authority with resource-enforced state; verify compatibility and failure modes; observe the distributed path; reconcile divergence; and introduce no more distribution than the requirement earns.**
