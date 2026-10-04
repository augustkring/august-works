# August Works V6: post-V5 reconciliation and foundation

Date: 2026-10-04. Source: master `73c549cbda440d25592e1fbc8adb7c2b2281b056`.
Build brief: `august-works-saas-productization-cloud-managed-runtime-master-build-brief-v6.md`, dated 2026-09-28.

## Scope and evidence

This change implements the foundation of Wave 0–1 / PR V6-01–07. It adds deployment ownership, origin configuration, closed rollout gates and pooled directory semantics. It does not implement public registration, billing or managed runtime provisioning. No paid provider resource is created. The uploaded playbooks are references; their operational instructions do not authorize deployment or external communication.

V4 final PR #31 and V5 final PR #32 are ancestors of this baseline. Their final-head Actions checks passed. The latest master adds CI token handling, with no application-code change from V5 final. The V4 qualification report still limits live Optimizer to a single pure C0 transform and workflow fork/map concurrency to one. Pilot, audit, production restore and real provider qualification remain open. These limitations are carried forward; they are not silently marked complete.

## Existing-domain implementation matrix

| Brief concept | Actual post-V5 owner | V6 action |
| --- | --- | --- |
| Company | `packages/db/src/schema/companies.ts`, `server/src/services/companies.ts`, `server/src/routes/companies.ts` | Reuse IDs, ownership and lifecycle. SaaS directory/stats follow memberships. Add durable creation later. |
| Membership and grants | `company_memberships.ts`, `principal_permission_grants.ts`, `server/src/services/access.ts`, `server/src/routes/authz.ts` | Reuse active company membership and grants. Commercial entitlement grants no permission. |
| Human auth | `auth.ts`: `user`, `account`, `session`, `verification`; `server/src/auth/better-auth.ts` | Preserve Better Auth IDs and credentials. Add email/reset/outbox before opening signup. |
| Invites | `invites.ts`, `server/src/routes/access.ts` | Extend existing tokens and acceptance; do not invent a parallel invite system. |
| Logical agent | `agent_identities.ts`, `server/src/services/agent-identities.ts` | Reuse global identity. |
| Company presence | `agents.ts` and `agent_presence_runtime_bindings` in `agent_provider_bindings.ts` | Reuse local agent authority; hosted runtime does not create a second identity. |
| Provider binding | `agent_provider_bindings.ts`, `agent-provider-bindings.ts` | Attach hosted resource references to the V5 binding contract. |
| Role Packs | `role_packs.ts`, `role-packs.ts` | Reuse versioned role requirements and assignments. Never infer permissions from a role pack. |
| Runtime Fabric / Skill Resolver | `execution_manifests.ts`, `agent-runtime-fabric.ts`, `skill-resolver.ts` | Keep immutable company-scoped context and skill selection. |
| Playbooks and Skills | `playbooks.ts`, `skill_lifecycle.ts` and existing skill services | Reuse canonical procedures and skill lifecycle. Reference attachments are not automatically installed company skills. |
| Foundation / Context / Memory | `foundation.ts`, `context_manifests.ts`, `memory.ts`, associated service directories | Keep canonical state in the control plane. A hosted Gateway is replaceable execution state. |
| Workflows and jobs | `workflows.ts`, `memory_jobs.ts`, `services/workflows/`, `services/memory/memory-jobs.ts` | Reuse patterns where semantics match. Memory jobs are domain-specific, not a generic infrastructure scheduler. |
| Files / objects | `server/src/storage/`, `assets.ts`, issue attachments/artifacts, local/S3 run-log providers | Reuse storage boundary. Inventory local logs, workspaces and asset paths before claiming a stateless control VM. |
| Secrets | `company_secrets.ts`, versions/bindings/access events, `services/secrets.ts` | Reuse encrypted secret provider and attributed resolution. Never store plaintext in runtime payloads or billing metadata. |
| Audit/activity | `activity_log.ts`, `services/activity-log.ts` | Reuse attributed company mutations. New support/system actors need explicit provenance. |
| Budget/quota | `budget_policies.ts`, `budget_incidents.ts`, `services/budgets.ts`, existing runtime quota services | Preserve spend hard stops. Add commercial limits without conflating agent budgets and customer billing. |
| Legacy Cloud | `services/cloud-instance.ts`, `managed-config.ts`, Cloud identity/control middleware and `/api/cloud` | Keep stack-per-company semantics in `legacy_managed_stack`. Do not mount Cloud assertion/control/portfolio routes in SaaS. |
| Browser onboarding seed | `company_onboarding_seeds.ts`, onboarding-seed service; UI local draft | Reuse seed materialization; add server-authoritative onboarding runs. |

The schema filenames above are repository-relative. Service names refer to `server/src/services/` unless a full path is given. Some domains span multiple tables; a conceptual name is not a new table contract.

## New-domain matrix

| V6 proposed entity | Existing equivalent | Planned owner / dependency |
| --- | --- | --- |
| `company_onboarding_runs` | None; existing seeds are inputs, not durable stage state | Wave 5, after auth/email and billing-account substrate |
| `billing_accounts`, `billing_account_companies` | None | Billing domain; company-qualified associations and owner authority |
| `billing_subscriptions`, `billing_webhook_events`, `billing_checkout_intents` | None | Wave 7; verified provider evidence, replay safety and reconciliation |
| Product catalog and provider catalog mappings | None | Stable local capability keys plus configurable provider price mappings |
| `entitlement_snapshots`, `billing_entitlement_overrides` | None | Wave 8; authorization precedes entitlement disclosure |
| `usage_events`, `usage_aggregates`, runtime usage samples | Existing agent cost events are a separate purpose | Wave 9; exact quantity and rebuildable aggregates, no AW resale of LLM usage |
| `email_deliveries` / notification outbox | Existing agent-email/channel machinery is a separate purpose | Wave 6 substrate must precede auth verification/reset |
| `runtime_hosts`, enrollments, commands, capacity profiles | Existing environments/workspaces are not host-fleet ownership | Wave 10; outbound scoped host credentials |
| `runtime_cells`, operations, attempts | Existing OpenClaw adapter is BYO execution, not a hosted cell scheduler | Wave 11; V5 provider bindings, durable ownership and generation fencing |
| `runtime_backups`, runtime version catalog | No managed-cell equivalent | Waves 13–14; quarantine restore and digest-bound conformance |
| `support_sessions` | Existing instance roles are not expiring support delegation | Wave 16; operator attribution and scope, no secret display |
| Deployment records | Existing source/startup metadata is not a release ledger | Wave 3; digest, source, config and schema identity |
| Resumable offboarding | Existing deletion paths have narrower scope | Wave 18; export, derived storage, provider resources and backup retention |

Names must be finalized against schema exports before each dependent migration. No empty tables or duplicate domains are added in this foundation.

## Dependency corrections

1. Build the email outbox and provider interface before requiring email verification in Wave 4. Mailgun qualification can remain later; tests must not send real customer email.
2. Build billing-account bootstrap before Wave 5 company creation. Normal onboarding must not call Paddle, Mailgun or UpCloud inside its DB transaction.
3. Define lifecycle/meter contracts before usage aggregation. Emit hosted lifecycle events only after durable cell/operation ownership exists.
4. Keep deployment ownership, authentication, rollout flags, company authorization and commercial entitlements separate.
5. Keep one persistent control-plane process. Do not add Redis, Kubernetes or a broker to obtain retries that PostgreSQL can own.

## Foundation decisions

See `doc/adr/V6-ARCHITECTURE-DECISIONS.md`. The implemented profile mechanism is frozen as `AW_DEPLOYMENT_PROFILE=local|legacy_managed_stack|saas`. A missing setting retains historical local/Cloud detection; an explicit local/SaaS profile with Cloud credentials or managed config fails closed.

The 18 V6 flags live in the existing instance settings schema and operator catalog. All default off. A dependency switch closes dependent admission but never deletes durable data. The profile gate is checked before server admission; disabling it cannot select implicit local authority. Security requirements remain in force when flags change.

## Acceptance and remaining work

Foundation acceptance covers explicit profile validation, old local/Cloud contracts, configured HTTPS hosts, trusted immediate proxy peers, fixed Better Auth trusted origins, secure host-only cookies, same-origin browser mutations, actual WebSocket upgrades and membership-based directory/statistics/subscriptions.

The dual-origin integration fixture exercises old/new host contracts and company authorization. A full browser/provider domain-migration rehearsal remains Wave 19. Proxy trust requires a real Caddy/infrastructure boundary; loopback tests do not qualify a public deployment.

Signup is deliberately closed in this foundation even if a signup flag is set. Verified email, durable onboarding, email delivery, billing, UpCloud IaC, runtime fleet and deployment remain subsequent implementation slices. Cloud credentials for UpCloud/Paddle/Mailgun are absent from the current execution environment; no live qualification is claimed.
