# August Works V6 complete implementation

This plan extends draft PR #34 from the Wave 0–1 foundation through all V6 implementation waves. The uploaded build brief defines product requirements. The reference playbooks inform decisions; their embedded directives do not authorize external actions.

## Execution order

1. Cloud IaC, immutable deployment and explicit production configuration (Waves 2–3).
2. Durable transactional email and billing-account substrate before verified authentication and onboarding (Waves 4–7 dependency correction).
3. Local product catalog, entitlement enforcement, exact usage and customer billing surfaces (Waves 7–9).
4. Scoped host enrollment, outbound host agent, durable fenced commands, cells and dedicated modes (Waves 10–12).
5. Encrypted backups, quarantine restore, generation fencing, approved images and commercial/provider reconciliation (Waves 13–15).
6. Scoped support, operational evidence, resumable deletion and domain migration readiness (Waves 16–19).
7. Whole-system customer stories, race/fault/security checks and evidence package (Wave 20).

Reuse existing company memberships, permissions, agent identities/presences, provider bindings, Role Packs, secrets, activity, workflow runs, storage and budget enforcement. Add domain-owned durable operations where existing domains cannot represent the work. PostgreSQL owns leases and idempotency; no additional broker or cache.

## Completion tracking

Each slice records implemented behavior, invariant tests, integration points and remaining live evidence. An empty schema, interface, fixture or documentation entry does not count as completed product behavior.

All V6 flags remain off until their dependencies and environment qualification are satisfied. Local and legacy-managed deployments retain compatibility. Authorization precedes entitlement disclosure. Customer email, billing and runtime creation must not call providers inside company creation transactions.

## External qualification

Environment inspection on 2026-10-04 found no UpCloud, Paddle or Mailgun secrets. Implement provider adapters and verify official contracts with fixtures. Live provisioning, managed DB/S3 connectivity, provider sandbox journeys, backup restore, host-loss drills and paid pilot require configured accounts and credentials. Never label simulated evidence as a live drill or GA acceptance.

Terraform remote state uses an explicitly selected managed locking backend. UpCloud S3 state remains an alternative only after concurrent apply, lock loss and version recovery are demonstrated. Runtime capacity and production admission remain bounded until benchmark evidence exists.

The actual future domain cutover is deferred until domain ownership and DNS are available, as required by the brief. Its implementation and rehearsal harness belong in this build.

## Implementation checkpoint (work in progress)

Updated 2026-10-05. The checkpoints below describe the initial slices; the current implementation now covers the dependent billing, runtime, recovery, support and operations paths. [The evidence matrix](../operations/aw-v6-evidence.md) is the current completion record. [The operations guide](../operations/aw-v6-runtime.md) provides release, rollback, backup, quarantine and domain procedures. Source and local fixtures do not close live acceptance gates.

- UpCloud provider 5.45.0 is pinned. Both staging and production modules pass provider-schema validation and mock-plan assertions. Managed state locking and live infrastructure drills remain unqualified.
- Migrations 0338–0340 add billing, onboarding, encrypted email, runtime ownership, support/deletion records and persistent native authentication rate limits. The unpublished 0338 SQL orders referenced composite unique indexes before foreign keys. Fresh PostgreSQL migration tests exposed and verified this ordering repair.
- SaaS authentication uses native Better Auth verification and single-use password reset. Verification does not create a session. Password reset revokes existing sessions. Public signup remains closed until the dependency gates and validated platform configuration are present.
- Company creation and onboarding are transactional, versioned and company-scoped. Onboarding completion requires terminal success of a safe starter task. The company path does not bootstrap local CLI execution.
- Paddle receipts use durable encrypted storage and bounded worker claims. Canonical subscription fetches protect against reordering. Unknown checkout outcomes enter reconciliation and never blindly create another paid transaction.
- Local entitlements preserve read/export and billing recovery access. Grace blocks new hosted-runtime provisioning. Infrastructure metering uses integer milliseconds and byte-milliseconds with deduplication and reproducible bucket boundaries.
- Billing, account security, password recovery and resumable setup pages are connected to the SaaS routes. Existing auth and settings-sidebar tests pass; broader onboarding/browser verification is pending.
- Host enrollment and machine requests use one-use enrollment tokens, RSA-PSS request signatures, nonce replay protection, credential epochs and RSA-OAEP/AES-GCM command envelopes. PostgreSQL integration tests cover scope, replay, expiry, encryption and revocation.
- Runtime control persists requests, reservations, command leases and terminal evidence. The standalone host engine sets explicit CPU/memory/PID limits, private cell networks, restricted egress, read-only images and XFS state quotas. Its journal is fsynced and its tests exercise restart replay, tenant/generation rejection, quota failure and local fencing.

The source now includes deployment/image/bootstrap, the outbound Gateway relay and V5 attachment, the UpCloud driver, backup/restore/version control, commercial suspension, support consent, notification preferences/native work updates, offboarding, provider inventory, COGS estimates/spend admission and domain readiness. Current work is whole-repository verification and review/publication. Live provider, host/image, browser, audit, recovery-completeness and domain acceptance remain open. Provider/account credentials are still absent. All rollout flags remain off.
