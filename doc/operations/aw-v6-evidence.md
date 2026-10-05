# August Works V6 implementation and evidence

Updated 2026-10-05. V6 remains a draft implementation with rollout gates off. Uploaded build-brief sections are product requirements; the attached playbooks are reference material. They do not authorize deployment or external communication. Missing source work, missing local proof and missing provider proof are different states.

## Source coverage

| Wave / requirement | Source and local proof | Remaining acceptance |
| --- | --- | --- |
| 0–1: V4/V5 prerequisites, profiles, membership, origins, flags | Existing V4/V5 source/history retained; profile/config/origin tests, actual HTTP/WS handshakes and feature dependency tests. | Re-run deployment/audit evidence on the admitted environment. |
| 2–3: cloud and immutable release | `infra/`, SaaS Docker targets, Caddy/Compose, role bootstrap, release CLI and pinned CI. Both Terraform environments validate and pass mocked plans. Actual PostgreSQL role tests reject DDL and reachable admin roles. | Live apply/state locking, private PG17/CA and S3 contracts; build/publish/admit qualified images. |
| 4–6: auth, mail, onboarding | Native verified Better Auth, single-use reset/session revocation, encrypted Mailgun outbox, company/account transaction, invitations and versioned onboarding UI. First-agent creation is serialized and durable, preserves native hire approval and performs no wakeup. Actual PostgreSQL/auth fixtures; starter completion checks actual matching run success. | Mailgun EU sandbox/domain proof and complete customer browser journey. |
| 7–8: billing and commercial access | Versioned mappings, encrypted receipts, canonical Paddle reconciliation, one checkout intent, portal/cancellation, exact local entitlements and shared-account access. | Real Paddle sandbox checkout/webhook/portal/cancellation stories and price mapping review. |
| 9: usage and COGS | Deduplicated integer meters, dirty-day rebuild, shared-account artifact quota, lost PUT/DELETE reconciliation, usage UI and operator cost snapshot/CPU allocation. Automatic creation needs an explicit EUR ceiling, current cost envelope and clean provider inventory. | Actual invoices, pricing/FX/discount assumptions and deployment cost baseline. COGS snapshots are operator-reported estimates, not an accounting ledger. |
| 10–12: hosts, cells, isolation modes, V5 attach | RSA enrollment/requests, encrypted generation-scoped commands, fsynced host journal, outbound relay, official UpCloud driver, bounded reservations and dedicated modes. Real relay and database fault/race tests plus isolated host-runner tests. | Qualified OpenClaw/base images, XFS and kernel isolation, packing/load benchmarks, provider host loss and occupied-host evacuation. |
| 13–14: backups and approved versions | Authenticated encrypted archives, quarantine restore, separate object identities, verified-backup retention, consented scheduled stop/snapshot/verify/resume, minimum agent version and canary/restore/run admission checks. | Live object API/retention, real canary execution, cross-host restore and version rollback drills. Operator report registration alone is not conformance proof. |
| 15: reconciliation and commercial stops | Unknown operations retain leases/evidence, provider-confirmed fence/VM+disk retirement, oldest-cell quota enforcement and retryable run cancellation. Provider inventory reports untracked/mismatched resources without destructive adoption. | Live bootstrap compensation/orphan handling and production timeout/load behavior. Occupied-host drain and relocation remain controlled operator procedures. |
| 16: notifications, support and admin | Native approval/task notifications, keyset-paged unread updates, preferences, verified operator allowlist, current owner consent, metadata/fleet/catalog/cost UI. HTTP/PG tests prove native global-role and settings elevation denial, ordinary operator denial and immediate support revocation. | Real provider email and production operator/support rehearsal. |
| 17: observability and SLO | Existing opt-in OTLP/Sentry, durable scheduler metadata, bounded encrypted run logs, provider inventory, operator cost estimates and body-free public-smoke harness. | Install and qualify external alerts/synthetics, choose measured initial SLOs, prove retention and cost telemetry. No fabricated availability/cost baseline. |
| 18: offboarding and cold recovery | Durable company deletion stages, physical resource/object-version confirmation, PG graph purge, minimal receipts, actual encrypted pg_dump/pg_restore with explicit rehome and tombstone replay; persistent application-startup quarantine. | Synchronous independent erasure receipts/completeness horizon before zero-resurrection acceptance; provider and full account-erasure drills. |
| 19: domain readiness | One origin contract, origin-free stored links, host-only cookies, dual-origin gates, Caddy configuration, sensitive URL inventory and rehearsal procedure. | Future-domain ownership/DNS/TLS, actual provider callbacks and browser/domain rollback rehearsal. No cutover performed. |
| 20: whole-system qualification | Fresh migrated PostgreSQL tests, auth/tenant/security fault tests, Node archive/host/release tests, UI scope tests and broad repository checks. | Full hosted customer browser stories, live acceptance reports, CI/review and GA approval. |

## Reproducible local checks

Use the repository's Node/pnpm versions. Embedded PostgreSQL tests require available native support and a normal readable umask. The database-role and cold-restore tests additionally require Docker and the explicitly pinned PostgreSQL client image. Without the image those two suites skip; a skip is not acceptance.

```sh
pnpm install --frozen-lockfile
pnpm -r typecheck
AW_TEST_DATABASE_DUMP_IMAGE=postgres@sha256:5a5a84b19854a9ffaa54082c166ff4ec27473a361e496e5ea167f298f2da9722 pnpm test:run
pnpm build
node --test deploy/v6/*.test.mjs
sudo "$(command -v node)" --test deploy/v6/host-agent/*.test.mjs
pnpm check:token-gates
pnpm check:module-boundaries
terraform fmt -check -recursive infra
```

Host-agent tests exercise real filesystem ownership changes to the cell uid/gid and need root, as the deployed host agent does. Use the absolute pinned Node executable with sudo. Archive, ledger, release and smoke tests run without root.

Run provider-schema validation and mock tests in both Terraform environment roots after initializing with `-backend=false -lockfile=readonly`. These operations do not apply real infrastructure. Use `server/src/__tests__/v6-` for a bounded acceptance rerun; use the full stable runner for regression coverage. Keep raw logs outside source control and record final results in the PR.

## Honest release boundary

No UpCloud, Paddle or Mailgun credentials were available during implementation. No infrastructure was applied, no production image was published, no customer message was sent, no billing transaction was created and no domain was changed. Provider fixtures, mocked plans and local PostgreSQL are labelled accordingly.

All SQL migrations are retained. The large deletion in migration metadata comes from the existing `prune:snapshots` generator step, which keeps the newest five snapshots. It does not remove product code, database tables or migration SQL. Review the SQL journal and apply it to a fresh database instead of using diff line count as an implementation-completeness measure.

The persistent quarantine guard closes accidental startup after recovery. It does not manufacture a complete post-backup deletion ledger. Keep restoration quarantined while that horizon, provider fencing or requalification is uncertain. Audit and launch qualification remain open even when the local source checks pass.
