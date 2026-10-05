# August Works V7 integrated pilot and qualification

Date: 2026-10-05. Build contract: user-supplied V7-v2, sections 256 and 207.

The current branch is an implementation candidate. It is not a qualified managed OpenShell product or a completed live customer pilot. The [implementation ledger](../plans/2026-10-05-aw-v7-build-progress.md) records each wave. The [acceptance manifest](../../evals/aw-v7/pilot-readiness.json) keeps the complete pilot journey, nine fault classes, three compound cases and operating evidence together.

## Current implementation boundaries

Four code paths still need implementation and verification: the authenticated native OpenShell host bridge and backend registration; credential-use brokering and revocation; model cost reservation before spend; and the bounded automatic read-only semantic consumer. These are code gaps, separate from missing live evidence. The current model-cost admission rejects a bounded plan until the broker is qualified. Semantic completion uses accountable independent human review. V7-bound native runtime start, upgrade, restore and migration remain closed. No reference file, manifest edit or checkbox grants execution authority.

The local host returns Landlock `ENOSYS`. The pinned actual OpenShell prover can establish supported policy subset relations. It cannot establish physical filesystem, network, resource, secret or Stop enforcement on this host. The [local boundary result](aw-v7-evidence/openshell-local-boundary-2026-10-05.json) remains `NOT_QUALIFIED`. Supply a suitable isolated staging host and its existing OpenShell gateway before attempting physical qualification. Keep credentials in the native secret store and the operator's private host configuration.

## Local safety behavior

The existing execution-control sweep now reconciles sandbox safety without requiring an enabled V7 flag or continued original-owner membership. It quarantines lost, expired or changed qualification and revokes current policy snapshots. A live bound cell currently represents a bypass of the closed applied-boundary admission path. The guardian therefore requests Stop through the existing runtime operation engine. The request has system attribution and an immutable cell generation. A generation change before dispatch cancels that request rather than targeting a replacement cell. A failed request remains pending for reconciliation. A request, quarantine record or delivery acknowledgement is not physical termination evidence.

Qualification rereads its capability snapshot after all eighteen probes. A changed image, kernel, credential attestation, control set or expiry cannot pass. A passing sequence cannot extend the original attestation deadline. The report hash binds both observed snapshots and the exceptions. Migration 0378 also invalidates bindings on native model, runtime provider, resource profile, isolation, host placement and gateway-reference changes, and on host credential rotation or host loss. These controls remain active after rollout rollback. The migration adds no customer data backfill; qualify its trigger installation and host-fanout lock behavior on representative staging data before deployment.

Local compound cases cover package/model/Foundation drift, source erasure plus owner revocation plus rollout rollback, and paid-capacity downgrade plus retained Foundation/Memory/export. Fixtures exercise native PostgreSQL constraints and consumers. They do not prove model quality, real channel delivery, provider isolation, customer demand, payment-provider availability or a physical boundary.

## Evidence coverage check

Run:

```sh
pnpm check:aw-v7-pilot-readiness
pnpm test:aw-v7-pilot-readiness
```

The first command validates the checked-in coverage manifest and reports every implementation blocker and missing live evidence item. A valid manifest is not a passing pilot. To require an evidence-complete candidate for operator review:

```sh
node scripts/check-aw-v7-pilot-readiness.mjs \
  --evidence /private/operator/v7-pilot-evidence.json \
  --protected-evidence-origin https://your-configured-protected-object-origin.example \
  --require-ready
```

The evidence JSON has `version: 1`, `evidenceKind: "live_customer_pilot"`, the exact current `sourceSha`, the native pilot `companyId` and an `evidence` array. Each entry has a manifest case `id`, `result: "pass"`, `evidenceKind: "protected_live_report"`, matching `sourceSha` and `companyId`, a protected HTTPS `/qualification/` `artifactUri`, a 64-character SHA-256, `testedAt` and `expiresAt`. The finite lifetime may not exceed thirty days. Do not put credentials, query-string access tokens, customer source bodies or provider error bodies in this metadata.

The checker rejects expired, future, duplicate, foreign-scope, wrong-revision, fixture and credential-bearing references. All four incomplete code paths also remain blockers even if every external evidence entry claims pass. The checker does not fetch or authenticate referenced artifact bytes. Its positive state means only that a complete reference set is ready for operator review. Native qualification, artifact authenticity, current scope authorization and actual deployment controls remain necessary. The command does not change flags or authorize model spend or deployment.

## Actual integrated pilot

Use one authorized pilot company and actual native owners, worker presences, connections and run receipts. Retain the exact source revision, deployment version, host/kernel/image, provider/model configuration, package version and purpose/oversight assessment. Record the complete journey from verified no-card signup through Foundation, readiness, agent installation, managed OpenShell, real channel work, supervision, human approval, retained outcomes, Learning proposals, governance/export and paid-capacity change/downgrade.

Inject each fault in the manifest. Include the complete prompt-injection/poisoned-Memory/unauthorized-tool/apparent-progress/exfiltration/escalation chain, the rejected sensitive-personal-inference case, and the package/model/stale-Foundation chain. Record actual deny, escalation, Stop and recovery receipts. A simulator or mocked tool callback cannot satisfy a physical or live-customer item.

Keep predecessor/provider, specialist customer-demand, Free Core measured-cost, enterprise identity/receiver/exit and contract/supplier/region/support evidence explicit. Each feature remains default-off until its applicable code and operational qualification are complete. Preserve customer-created Work, Memory, Foundation and export access during commercial downgrade and feature rollback.

## Repository verification

Before a broad handoff, run `pnpm -r typecheck`, `pnpm test:run` and `pnpm build`, plus migration, module and token gates. Record exact commands and actual exits. A focused pass, an unfinished repository run or a run across changing sources must not be reported as a clean full-revision acceptance pass. CI, real customer work and enterprise GA are separate states.
