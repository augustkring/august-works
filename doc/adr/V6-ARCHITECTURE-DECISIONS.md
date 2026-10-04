# August Works V6 architecture decisions

Date: 2026-10-04. Status: implemented foundation decisions; production qualification remains open.

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

**Evidence:** Origin parser, action URL and dual-origin integration tests. Wave 19 remains open.

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

**Migration:** Existing unconfigured deployments retain their behavior. Signup remains closed pending auth/email implementation.

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

The following decisions must be written before their first dependent implementation. This list records pending design work, not an implemented or live-qualified capability.

| ADR | Decision topic | First dependent slice |
| --- | --- | --- |
| 002 | UpCloud Copenhagen primary cloud | Wave 2 |
| 006 | Managed PostgreSQL | Wave 2 |
| 007 | S3 object storage and backup region | Wave 2–3 |
| 008 | IaC versus dynamic controller ownership | Wave 2 / 10 |
| 009 | Managed OpenClaw cells | Wave 11 |
| 010 | Outbound Runtime Host Agent | Wave 10 |
| 011 | Runtime generations and fencing | Wave 10–11 |
| 012 | BYOK commercial model | Wave 7–8 |
| 013 | Paddle Merchant of Record | Wave 7 |
| 014 | Local entitlements | Wave 7–8 |
| 015 | Exact usage events | Wave 9 |
| 016 | Mailgun EU transactional outbox | Before auth verification |
| 017 | Durable onboarding | Before company creation |
| 018 | Support and break-glass | Wave 16 |
| 019 | Backup, recovery and encryption | Before deployment / runtime restore |
| 022 | Portability and Scaleway trigger | Before provider infrastructure |
