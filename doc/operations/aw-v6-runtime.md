# August Works V6 operations

Updated 2026-10-05. This guide covers the source implementation. It does not authorize deployment, spending, customer messages or a DNS change. Production qualification is open. Keep the rollout flags off until the evidence in [aw-v6-evidence.md](aw-v6-evidence.md) exists.

## Ownership and prerequisites

The Copenhagen control VM serves the React app, API and WebSocket transports through Caddy. PostgreSQL owns company state, commercial state, leases and idempotency. Runtime hosts own disposable execution and encrypted recoverable state. Finland object storage holds application artifacts, exports, runtime archives and database archives in separate buckets. Do not introduce a broker, Redis or Kubernetes for this release.

Use separate staging and production provider accounts, HCP workspaces, domains, databases, buckets and keys. Terraform 1.12.2 and UpCloud provider 5.45.0 are pinned. Select the HCP organization explicitly. Remote-state credentials can disclose database and object credentials; restrict state access and audit it. The mocked Terraform tests do not establish locking, network reachability or disaster recovery.

Terraform owns the fixed network, NAT, control VM, managed database and object-store substrate. The durable runtime controller owns labelled runtime hosts and disks. Never import those dynamic resources into the fixed Terraform module or delete them from an unscoped inventory.

Before a live apply, review the plan, firewall, regions, SSH source addresses and provider prices. Live state locking, concurrent-apply rejection and state recovery must pass. Confirm that PostgreSQL has no public endpoint and all managed connections use `sslmode=verify-full` with the provider CA. Confirm object-store API compatibility, version listing and deletion, lifecycle policy and backup-write restrictions. Bucket versioning and immutable retention are not proved by the current Terraform source.

SaaS disables the native global user-admin API and native instance-role elevation. Global settings writes require a current verified session on the environment operator allowlist. Company authority remains subject to current memberships and V4/V5 permissions.

## First company and agent

The welcome flow creates one company/account transaction and saves onboarding stages with a version check. First-agent creation takes the onboarding lock and returns the same agent after concurrent retries or a lost response. It creates a pending native hire approval when the company requires one; otherwise it creates a paused agent. Timer heartbeats are disabled and the initial budget is zero.

Approve the hire through the existing company approval surface. Bind the agent to its runtime and company-owned provider secret. Review the budget and runtime configuration before starting it. The starter task is a safe proposal in backlog; creation does not dispatch it. Onboarding becomes complete only after that agent has a successful run for that exact task.

## Secrets and immutable images

Start with `deploy/v6/platform.env.example`. Provision independent Better Auth, company vault, email encryption, recipient HMAC, billing-payload and run-log keys. Database archive encryption and deletion-ledger signing use separate operator-only keys. Retain old encryption keys until all referenced archives or payloads have expired or been rekeyed. Never place platform credentials in a host command, Gateway config, browser variable or customer export.

The application identity can read/write artifacts and exports. Backup writers can only write their bucket. Restore readers can only read it. Retention identities can list and delete versions. Runtime hosts receive short-lived object URLs for one archive, never these identities. The managed PostgreSQL application, migrator and backup roles are distinct.

The manual image workflow publishes control, database-backup and host-agent images with source revision, SBOM, provenance and immutable digest artifacts. It requires qualified digest-pinned base images. It has not been dispatched as part of this work. Build the `saas` and `saas-backup` Docker targets, not the legacy production target with local LLM CLIs. Qualify the host base separately with Node 24, Docker, XFS project quotas and iptables. Reject a mutable OpenClaw tag; qualify the exact image digest and state format.

## Database bootstrap and release

Run `deploy/v6/db-roles.sql` through the provider bootstrap role with explicit `app_role`, `migrator_role` and `backup_role` psql variables. That role needs the provider's approved privileges to install required extensions and grant access. The migrator needs database CREATE for the first Drizzle schema. The application must have no CREATE, table ownership or reachable elevated role, including NOINHERIT memberships. The backup role has SELECT only. After adopting an existing schema, transfer its application-table ownership to the migrator through a reviewed one-time procedure; granting the application an admin role is not an adoption procedure.

Keep `/etc/august-works/platform.env`, operator environment files and private keys root-owned, mode 0600. Docker reads the env file as root; the containers run as uid 1000. Archive directories must be mode 0700 and writable by uid 1000. The CA certificate is public and must be readable inside the container. Bind the application and relay to loopback, set `TRUST_PROXY=loopback`, and expose only Caddy 80/443 plus restricted operator SSH.

Release sequence:

1. Obtain a fresh encrypted archive of the currently deployed schema. Verify its complete ciphertext through the separate read identity. Save the receipt and keys outside the control VM.
2. Run `server/scripts/v6-release.mjs migrate` in the new digest-pinned image with the separate `AW_DB_MIGRATOR_URL`, public deployment settings, operator identity and backup receipt. The migrator and application URLs must identify the same database. An advisory lock prevents concurrent migration jobs. An untracked nonempty database requires explicit reconciliation.
3. Run the role grants again if the provider bootstrap/default-grant model requires it. Run `v6-release.mjs preflight` with the application identity. The source stamp and digest must match the release configuration.
4. Validate the Compose admission settings, switch the control digest, and verify Caddy HTTP/WS, application health and the operator metadata view. The health probe supplies the public host and trusted HTTPS forwarding contract. Run `v6-release.mjs record` only for the admitted release.
5. Enable dependency-complete flags in the existing operator settings surface. Start with internal canaries. Do not enable public signup, checkout or runtime admission while their provider qualification is pending.

SaaS startup never auto-migrates. It refuses a stale schema and a quarantined restore. It never falls back to local authority. Existing migration SQL remains authoritative; generated snapshot pruning is not SQL deletion. Drizzle intentionally retains the newest five snapshots.

Rollback first closes new signup, checkout and runtime admission. Continue safety stops, reconciliation, offboarding and retention. An old application image is usable only if its schema contract is compatible. Otherwise use a forward fix or isolated restore; never run a down migration or rewrite migration history to make an old image start.

## Email, billing and commercial safety

Verify the Mailgun EU sending domain, SPF/DKIM, webhook signing and staging recipient allowlist. Exercise verification, single-use reset, session revocation, expired payloads, suppressed recipients and a lost send acknowledgement. Mailgun webhook handling and canonical lookup must confirm acceptance before a retry. Email payloads are encrypted at rest and deleted after delivery or expiry. Security email cannot be disabled. Approval and task updates reuse the native activity log, with durable processing receipts and optional email preferences.

Create Paddle sandbox mappings for the versioned local product catalog before checkout admission. Prove webhook signature/replay handling, canonical subscription ordering, unknown checkout reconciliation, portal access, scheduled cancellation and shared-account offboarding. Provider products identify entitlements; local permissions still identify who can act. Paid recovery does not unpause budget-stopped agents or restart runtimes.

Usage is integer-based. Runtime CPU tiers and active time are infrastructure usage. Customer application artifacts consume the shared billing-account storage quota and byte-milliseconds. Internal run logs, runtime workspace overhead and safety backups do not consume customer application storage quota. Confirm invoices and provider cost inputs before accepting any quoted margin or cost per company.

The operator cost report uses `saasCostReportSchema`: current UTC month, EUR minor-unit decimal strings, protected `/cost-reports/` URI/hash, provider invoice or price-estimate basis, platform monthly cost, configured host plan, conservative new-host monthly envelope, every live host's cost, and every current active account's reported MRR. It is append-only and idempotent. CPU reservation allocation conserves the host envelope and displays unused capacity separately. ARR is reported MRR × 12; gross margin subtracts the reported monthly infrastructure envelope. These are operator estimates; historical invoices, FX, discounts, tax and changing capacity need separate finance review.

`RUNTIME_CONTROL_MAX_ESTIMATED_MONTHLY_EUR_MINOR=0` closes automatic host creation by default. A positive limit additionally requires a current-month cost report no older than seven days, the same host plan, a fresh clean provider inventory and a conservative platform + (all unretired hosts + new host) envelope within that limit. Count and hourly-create ceilings still apply. Named operators perform initial benchmark/bootstrap host admission; automation does not infer prices from a plan name.

## Hosts, versions and scheduled backups

Register qualification reports and capacity profiles through the named operator surface. Report metadata is an operator attestation, not an independent rerun of its tests. Image approval additionally requires a healthy canary, successful provision, verified archive/restore pair and successful V5-bound agent execution after restore. Retired images admit no new cells; halted images close admission immediately. A host must meet the image's minimum agent version.

Host requests use RSA-PSS, nonces and credential epochs. Enrollment expires and is single-use. Commands use encrypted envelopes, generation checks, durable journals and scoped terminal evidence. Unacknowledged outcomes remain recoverable. A full journal reserves bounded room for stop/delete and prunes only terminal receipts acknowledged more than 30 days ago. A missing heartbeat first degrades the host; execution cannot be readmitted until the old provider execution has been fenced.

Drain closes new placement. Stop, back up and explicitly migrate eligible cells before retirement; the current controller does not automatically evacuate an occupied shared host. Provider retirement confirms server and owned disk absence. Do not interpret a successful delete HTTP response as proof of physical erasure. An absent result for a timed-out creation requires ownership reconciliation, not another create.

Scheduled runtime backup is customer-approved, daily or weekly. A healthy cell requires explicit brief-pause consent and current paid resume authority. A manually stopped cell stays stopped. The scheduler requests stop, snapshot, verification and resume as separate durable operations. Unknown results wait for reconciliation. Generation or permission changes stop the cycle. A verified archive is required before resuming. Agent budget and approval state remain untouched.

Runtime archives use independent per-archive encryption, bounded state streams, integrity checks and offline quarantine restore. Restore advances the generation, revokes old bindings and removes saved provider credentials. The customer must reattach BYOK and explicitly start the cell. Retention deletes all archive versions before erasing its key, and protects archives referenced by active or unknown operations.

## Database backup and cold recovery

Use `deploy/v6/database-backup.env.example` with the separate `saas-backup` image and backup database role. Install the supplied hourly backup and five-minute deletion-ledger timers only after qualification. Keep their image digest in `backup-image.env`. The archive worker fsyncs local state, uploads an authenticated encrypted custom PostgreSQL dump, reads it back and writes a success receipt. A pending archive is retried with the same object identity. Alert on missing success receipts, disk exhaustion and failed timers.

`export-ledger` reads a consistent repeatable-read snapshot of company deletions, memory erasures and explicit identity homes. It signs and writes an immutable ledger plus `deletion-ledgers/<environment>/latest.json` outside database archives. `fetch-ledger` reads this object through the restore identity, applies size and authentication bounds, and writes it locally. Preserve older signing keys and immutable ledger versions through the recovery horizon.

For a cold restore, create an empty loopback-only `aw_restore_*` database. Supply the archive, archive key ring and authenticated post-archive ledger to `restore-quarantine`. The worker authenticates the full archive before pg_restore, migrates the isolated copy, revokes sessions/keys/host credentials, cancels effects, disables schedules and rollout gates, advances runtime generations, replays explicit rehomes and reapplies erasures. It writes a persistent `awV6RestoreQuarantine` marker. Every application profile refuses this database until recovery admission is reviewed.

The five-minute ledger export is not a zero-loss deletion guarantee. A disaster can occur between an acknowledged erasure and its next external ledger export. Never promote a restore solely because `latest.json` is fresh. Establish the authoritative deletion horizon from independently retained evidence, compare all affected company/memory tombstones and preserve quarantine while completeness is uncertain. A synchronous independent deletion receipt remains required for a zero-resurrection acceptance claim. The current local test proves correct replay of an authoritative supplied ledger, not completeness after an arbitrary disaster.

Recovery admission requires documented provider fencing, complete erasure replay, secret rotation, billing/provider reconciliation, V5 requalification, backup restoration tests and a new release record. Preserve the quarantine evidence. Only the dedicated operator/migrator procedure may remove `general.awV6RestoreQuarantine` after these checks; no customer or support API provides this action. Leave rollout flags off until canaries pass again.

## Support and deletion

Internal access requires a verified native user on `AW_INTERNAL_OPERATOR_USER_IDS`. Instance admin alone is insufficient. Customer data access additionally requires a current owner-approved, named-scope, expiring support grant. Revoke it to close access immediately. Overrides are bounded, expiring and audited. The metadata view exposes queue, host and deployment state, not prompts, keys or provider payloads.

Company offboarding requires exact company-name confirmation and export acknowledgement. It archives the company, pauses/revokes authority, deletes or fences runtime execution, reconciles billing, waits for retained backups, erases all object versions, then purges PostgreSQL content and keeps a minimal receipt. Retry the same operation after a lost response. Shared identities must be explicitly rehomed before deleting their home company. A purge failure or unknown provider state keeps deletion incomplete.

## Domain migration and URL inventory

Initial origin: `https://ai.augustworks.dk`. Future origin: `https://app.augustworks.ai`. The latter remains deferred until ownership, DNS and certificates are available. Configure the new primary and explicit legacy origin, enable the dependency-complete dual-origin flag and restart. Caddy serves both hosts during the migration window. Sessions stay host-only; users sign in on the new domain. Do not share cookies across registrable domains.

| URL owner | Inventory and rehearsal |
| --- | --- |
| Better Auth | Verification, reset, invitation and OAuth callbacks; both hosts must preserve tokens without access-log disclosure. |
| Paddle | Checkout success/return URLs, portal return and signed webhook endpoint; change provider configuration and test sandbox delivery. |
| Mailgun | Signed webhook endpoint, sending domain and stored origin-free email action paths; validate old queued links. |
| Runtime hosts | Enrollment/control/relay authority; replace or requalify hosts before removing the old authority. |
| App integrations | OAuth callbacks, external app links and customer-configured Gateway endpoints; inventory every enabled provider. |
| Exports/support | Origin-free product links, archive object URLs and support links; retain expiry and access controls. |

Do not issue a catch-all redirect on verification/reset/invitation/OAuth or signed-provider routes. Keep sensitive routes on the addressed host or use an explicitly reviewed migration handler. A redirect must not copy a query token to another authority. Rehearse HTTP and WebSocket origin denial, current-company visibility, fresh login, old/new email links, checkout/portal return, worker callbacks, support revocation and temporary rollback. `deploy/v6/public-smoke.mjs` produces body-free public health/login/access-denial evidence; it is only one part of this rehearsal.

## Observability and launch evidence

The existing OTLP and Sentry integrations remain operator-configured. Keep prompt content, secrets, tokens and raw provider bodies out of traces, errors and access logs. The operator snapshot includes scheduler success/error metadata, billing/email queues, runtime operations, host state and deployment records. Customer run logs use bounded encrypted buffering and object archival; they are distinct from first-party telemetry.

Configure external synthetics and alerts for health, login, HTTP/WS reachability, queue age, stale leases, duplicate provider ownership, host loss, backup and ledger age, disk/PG/S3 capacity, erasure backlog and cost ceilings. Run public-smoke on every enabled app origin and retain time-stamped results. Establish measured SLO, recovery-time and cost baselines on the actual deployment. Source checks, provider fixtures and mock plans are insufficient evidence for these baselines.

Before a paid pilot, run real Mailgun/Paddle sandbox customer stories, XFS/resource/network isolation, OpenClaw/V5 conformance, host-loss fencing, cross-host restore, failed migration/rollback, database cold recovery with complete deletion evidence, concurrent state locking and domain rehearsals. Record image/source digest, schema, environment, flags, operator, timestamp and protected report hash for each drill. Never replace a failed or missing drill with a boolean fixture.
