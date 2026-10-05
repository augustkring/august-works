# August Works V6 architecture decisions

Date: 2026-10-05. Status: implementation decisions; production qualification remains open. The implementation and live-evidence boundaries are tracked in [the evidence matrix](../operations/aw-v6-evidence.md).

## V6-ADR-001 — Pooled SaaS tenancy

**Context:** The legacy Cloud service binds one stack to a primary company. V5 already separates logical agents and local authority.

**Decision:** Run a pooled SaaS service. Product company lists, stats and subscriptions follow current memberships. Reuse company IDs and V5 identities.

**Alternatives considered:** A VM/control-plane stack for every company

**Why not the alternative:** It duplicates deployment, billing and recovery and raises baseline cost.

**Invariants:** No pinned primary company in SaaS. Entitlements never grant tenant access.

**Trade-offs and risks:** Operators need separate support scope instead of a product-directory bypass.

**Cost effect:** Share control-plane cost; preserve separate runtime trust boundaries.

**Failure effect:** A control-plane outage can affect multiple companies; restore and SLO evidence are required before launch.

**Security effect:** Company membership remains the authority boundary.

**Migration:** No automatic conversion of BYO adapters or legacy stacks.

**Reversal trigger:** Measured pooled isolation/capacity failure or a legal isolation requirement.

**Evidence:** Company-route and WebSocket membership tests; V5 schema and services.

**Assumptions:** The post-V5 authority/schema contracts remain valid.

**Reversal cost:** Preserve tenant IDs and evidence; migrate configuration and dependent contracts before changing this decision.

## V6-ADR-003 — One persistent deployable

**Context:** The app owns Express, React serving, WebSockets and durable reconciliation services.

**Decision:** Keep one persistent Node control-plane deployable in V1. PostgreSQL owns durable domain state; runtime execution stays separate.

**Alternatives considered:** Serverless API or early service split

**Why not the alternative:** Persistent transports and recovery already fit the existing server and a service split adds coordination failures.

**Invariants:** No in-memory-only provisioning ownership. Hosted runtime cannot become canonical company state.

**Trade-offs and risks:** One process simplifies releases but needs bounded background work.

**Cost effect:** Avoid baseline broker and multi-service operations cost.

**Failure effect:** Restart requires reconstruction from durable state.

**Security effect:** Keep secrets scoped; isolated runtimes must not share control-plane credentials.

**Migration:** Preserve current service boundaries; add domain outboxes where needed.

**Reversal trigger:** Measured independent scaling or failure-containment need.

**Evidence:** Existing app/index architecture and V4 durable workflow/memory patterns.

**Assumptions:** The post-V5 authority/schema contracts remain valid.

**Reversal cost:** Preserve tenant IDs and evidence; migrate configuration and dependent contracts before changing this decision.

## V6-ADR-004 — Same-origin app/API/WebSocket

**Context:** HTTP middleware does not run on WebSocket upgrades. Legacy origin derivation admits HTTP/port variants.

**Decision:** Use one explicit HTTPS origin contract for app, API, auth and WS. Apply the same configured allowlist to HTTP and upgrades before authentication.

**Alternatives considered:** Split app/API hosts with broad CORS

**Why not the alternative:** It adds cookie/CORS and cross-domain session complexity without a demonstrated need.

**Invariants:** Only trusted immediate proxy peers supply forwarding authority. An Origin must match the addressed host.

**Trade-offs and risks:** Internal probes must use the configured host and proxy protocol.

**Cost effect:** No additional edge/API service.

**Failure effect:** Bad host/proxy config fails closed instead of expanding trust.

**Security effect:** SaaS cookies are Secure, HttpOnly, Lax and host-only. Untrusted forwarding headers are discarded.

**Migration:** Leave existing local and legacy origin behavior in their profiles.

**Reversal trigger:** A reviewed requirement for a separate API surface with an explicit auth contract.

**Evidence:** v6-public-origin integration tests, including actual WS handshakes.

**Assumptions:** The post-V5 authority/schema contracts remain valid.

**Reversal cost:** Preserve tenant IDs and evidence; migrate configuration and dependent contracts before changing this decision.

## V6-ADR-005 — Temporary origin and future migration

**Context:** The initial app origin and future registrable domain differ. Cookies cannot safely be shared between them.

**Decision:** Store origin-free action paths and build outbound links from PublicOriginConfig. Legacy origin serving requires the dual-origin gate.

**Alternatives considered:** Hardcode the initial host or share cross-domain sessions

**Why not the alternative:** Both make future migration fragile or add unnecessary secret-bearing handoff mechanisms.

**Invariants:** No production hostname literal in feature code. No cross-registrable-domain cookie sharing.

**Trade-offs and risks:** A user may need to sign in once on the new domain.

**Cost effect:** Migration is primarily configuration/provider callback work.

**Failure effect:** Old sensitive token routes must be evaluated before enabling redirects.

**Security effect:** No external action path can override the configured origin.

**Migration:** Configuration and DNS change only after callback inventory and rehearsal.

**Reversal trigger:** A real requirement for cross-domain session handoff, with a reviewed security design.

**Evidence:** Origin parser, action URL, dual-origin integration tests, public smoke harness and operations URL inventory. Live domain rehearsal remains open.

**Assumptions:** The post-V5 authority/schema contracts remain valid.

**Reversal cost:** Preserve tenant IDs and evidence; migrate configuration and dependent contracts before changing this decision.

## V6-ADR-020 — Legacy Cloud compatibility and profiles

**Context:** Old deployments signal Cloud through a tenant token or managed config. Random old variables must not select the new SaaS model.

**Decision:** Add local, legacy_managed_stack and saas ownership profiles independent of local_trusted/authenticated modes. Preserve historical fallback only when the profile is absent.

**Alternatives considered:** Remove Cloud or infer SaaS from missing tenant token

**Why not the alternative:** Either breaks existing stacks or silently widens authority.

**Invariants:** Explicit local/SaaS plus a legacy managed signal is a startup error. SaaS does not mount Cloud control/identity routes or workspace-handoff auth.

**Trade-offs and risks:** An operator must remove incompatible injected configuration before changing ownership.

**Cost effect:** Retain compatibility without running another deployable.

**Failure effect:** An invalid rollout gate prevents admission; it never falls back to local authority.

**Security effect:** Cloud credentials cannot be used as pooled SaaS authority.

**Migration:** Existing unconfigured deployments retain their behavior. Signup requires the implemented auth/email dependency gates and provider qualification.

**Reversal trigger:** A reviewed end-of-life plan for legacy stacks.

**Evidence:** Cloud-floor, managed-origin, credential-cookie and new profile tests.

**Assumptions:** The post-V5 authority/schema contracts remain valid.

**Reversal cost:** Preserve tenant IDs and evidence; migrate configuration and dependent contracts before changing this decision.

## V6-ADR-021 — No early orchestration infrastructure

**Context:** The app already uses PostgreSQL for durable workflows, jobs, locks and reconciliation.

**Decision:** Do not introduce Kubernetes, Redis or a message broker for the initial control plane. Domain operations must be durable and leased in PostgreSQL.

**Alternatives considered:** A cluster and shared broker from the start

**Why not the alternative:** They increase cost and failure modes before load provides evidence for them.

**Invariants:** Leases, generations and external-effect idempotency must be explicit. Existing Memory jobs are not a generic fleet scheduler.

**Trade-offs and risks:** A single VM needs tested recovery; separate runtime hosts contain execution risk.

**Cost effect:** Lower baseline infrastructure and operational cost.

**Failure effect:** Provider/broker outages must not be required for ordinary company reads.

**Security effect:** Keep runtime provisioning credentials outside customer execution.

**Migration:** Add scoped durable operations to existing PostgreSQL instead of substituting company workflow editors.

**Reversal trigger:** Measured contention, backlog, independent scaling or availability requirement.

**Evidence:** V4 jobs/recovery architecture; later runtime operations require their own qualification.

**Assumptions:** The post-V5 authority/schema contracts remain valid.

**Reversal cost:** Preserve tenant IDs and evidence; migrate configuration and dependent contracts before changing this decision.

## Required dependent ADR inventory

The following decisions govern the dependent implementation. Their operations procedures are in [the V6 guide](../operations/aw-v6-runtime.md). A source decision does not qualify its provider or environment.

| ADR | Decision, invariant and reason | Alternative / cost and failure consequence | Evidence and reversal condition |
| --- | --- | --- | --- |
| 002 | UpCloud Copenhagen primary cloud; private control/runtime SDNs and Finland objects. This follows the V6 regional requirement. | A multi-cloud launch increases baseline operations and failure coordination. Provider outage affects the pooled service. | Pinned IaC schema/mock plans and official API driver; live network/fencing remain open. Reverse after a measured region, legal, reliability or cost failure. |
| 006 | Managed PostgreSQL 17 with verify-full TLS and separate app/migrator/backup roles. PostgreSQL owns transactions, locks and recovery state. | A self-managed production DB adds patch/failover duties. Managed DB costs enter fixed COGS; DB outage stops admission. | Real PostgreSQL migrations and role bootstrap tests. Qualify the provider's PG17 permissions/CA; reverse on measured managed-service constraints. |
| 007 | S3-compatible, EU/Finland objects, with separate artifact/export/runtime/database buckets and least-privilege identities. | VM-local durable storage prevents reliable cold recovery. Separate identities increase setup but contain writer compromise. | IAM source and storage/archive tests. Versioning/lifecycle/retention require live tests. Reverse only with proven portability and erasure compatibility. |
| 008 | Terraform owns fixed substrate; the PostgreSQL controller owns labelled dynamic hosts/disks. | Managing dynamic host churn through Terraform introduces dual ownership. State exposure is an operator risk. | Mock plans, ownership/unknown-create tests and provider inventory. Reverse when a replacement retains one canonical owner and recovery identity. |
| 009 | Digest-pinned OpenClaw company cells, explicit quotas, private networks, no Docker socket or platform credentials. | A gateway embedded in the control plane weakens tenant isolation. Host packing lowers COGS but raises shared-host failure impact. | Standalone host engine and V5 relay/control tests. Actual kernel/XFS/image conformance remains open; reverse on measured isolation failure. |
| 010 | Outbound RSA-authenticated host agent and encrypted commands; a separate loopback relay bridges current company/generation. | Public gateway ports enlarge the attack surface. The outbound connection adds bounded reconnection and heartbeat work. | Enrollment/replay/revocation and actual relay tests. Reverse only with equivalent network and credential containment. |
| 011 | Generations, durable command claims and provider-confirmed fencing precede execution readmission. Unknown effects require reconciliation. | Blind retries can duplicate paid resources or execution. Fencing increases recovery time to preserve authority. | Concurrent admission, terminal evidence and lost-ack tests. Reverse only with a proven equivalent fence, never by timeout alone. |
| 012 | Customers provide scoped model credentials; AW sells infrastructure and product access. Model keys enter only the assigned runtime's encrypted delegation/private config. | Reselling inference adds pricing and gross-margin exposure. BYOK adds customer setup and rotation responsibilities. | Fixed provider endpoints and scoped secret/config tests. Reverse after an explicit commercial/security redesign. |
| 013 | Paddle is Merchant of Record; canonical provider reads repair reordered or ambiguous events. | A direct payment processor adds tax/accounting duties. Checkout availability depends on Paddle; local state remains readable during failure. | Durable encrypted receipts, checkout locks, cancellation and reconciliation tests. Reverse when a migration preserves subscription/customer ownership. |
| 014 | Locally composed OR/SUM entitlements with exact bounded values, expiring overrides and grace/read recovery. Permissions always precede entitlement access. | Calling Paddle on every product request couples authorization to provider latency. Local state requires reconciliation. | Shared entitlement tests, real domain/HTTP denial tests and commercial suspension tests. Reverse only with equivalent outage/read recovery behavior. |
| 015 | Deduplicated integer usage and transactional meter watermarks. Bill application artifacts, not internal logs or safety backups. Operator cost reports retain unknown amounts until evidence exists. | Floating point and invoice-total-only attribution conceal rounding and unused host costs. Exact integers simplify replay but need bounded aggregates. | Usage/storage/concurrency tests and COGS allocation tests. Reverse when another representation proves conservation and account ownership. |
| 016 | Mailgun EU plus encrypted bounded outbox, logical delivery identity, suppression and expiring payloads. | Synchronous email in company/auth transactions couples availability to delivery. The outbox adds retries and operational queues. | Actual auth flows with provider fixtures and outbox fault tests. Live EU delivery remains open. Reverse with equivalent regional and lost-ack guarantees. |
| 017 | Versioned resumable onboarding reuses companies, V5 identities, foundation documents and a backlog starter task. Completion requires successful matching execution. | A one-shot client wizard loses recovery state and can bypass budget/approval gates. The server state adds small fixed storage cost. | Real PostgreSQL retry and starter-task tests. Reverse only while preserving company ownership and actual completion evidence. |
| 018 | Verified named operators; customer content requires owner-approved, named-scope, expiring consent. No unrestricted break-glass data endpoint. | Instance-admin product bypass would widen tenant authority. Operator recovery procedures are slower and auditable. | Operator HTTP denial, scope expiry/revocation and override tests. Reverse only after a separately reviewed, bounded emergency authority design. |
| 019 | Independent encrypted runtime/database archives, authenticated erasure ledger and persistent quarantine before cold-recovery admission. | Provider snapshots alone do not prove credentials were revoked or deletions replayed. Independent archives and drills add internal COGS. | Actual PostgreSQL dump/restore, crypto/retention tests and quarantine admission refusal. Ledger completeness after arbitrary disaster is open; never reverse the erasure/fencing invariants. |
| 022 | Keep provider interfaces narrow and resource IDs labelled; reconsider Scaleway only for measured legal, reliability, feature or COGS benefit after migration cost. | Premature multi-cloud execution adds duplicate ownership and state migration risk. Portability is an option, not a second active driver. | Separate IaC/controller boundaries and provider fixtures. A switch requires rehearsed DB/object/runtime migration and restoration of the same scope/fence guarantees. |
