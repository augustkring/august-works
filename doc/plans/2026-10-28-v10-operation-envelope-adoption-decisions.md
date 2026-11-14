# V10 operation-envelope adoption decisions

This note records the bounded V10-024 decision from current domain owners. The
shared `CustomerOperationReceipt` is a customer-facing projection; domain
owners retain authorization, effects, cancellation, and recovery authority.
Do not convert it into a generic workflow or duplicate native ledgers.

| Domain | Current owner/evidence | Decision |
|---|---|---|
| Company import | `server/src/services/company-import-jobs.ts`, import routes in `server/src/routes/companies.ts`, shared `CustomerOperationReceipt` | Adopt the existing envelope projection. The durable import job remains authoritative for request idempotency, worker lease, effect checkpoints, cancellation, terminal result, and unknown-outcome reconciliation. Keep import-specific fields and authorization in that owner. |
| Company export | `companyPortabilityService.exportBundle` in `server/src/services/company-portability.ts`; routes in `server/src/routes/companies.ts` | Do not adopt the durable-operation envelope by default. Export currently returns a bounded, authorized bundle through the domain owner and revalidates source scope; use its existing response/download semantics. Revisit only if a supported export becomes asynchronous or restart-resumable, and then project its native export receipt rather than moving the work into a generic engine. |
| Company deletion | `companyService.remove` behind `DELETE /companies/:companyId` in `server/src/routes/companies.ts` | Keep the company lifecycle owner and existing response. The inspected route is synchronous and board-authorized; a generic customer-operation row is not justified by source evidence. If deletion becomes asynchronous, define a deletion-owned durable receipt and privacy/retention behavior before adding a projection. |
| Account deletion | `server/src/services/saas/account-deletion.ts` and `account_deletion_operations` | Keep its separate durable owner. It includes fresh-session/password/factor checks, last-owner and billing preconditions, access erasure, provider secret deletion, and a retrying processor. Do not replace it with company import's envelope or expose account-private fields through a company operation API. |
| Backup restore | `server/src/services/saas/support.ts`, `server/src/services/saas/quarantine.ts`, backup/restore domain records | Keep the support/restore operation and quarantine ledger. Restore admission is security-sensitive and includes isolated-target checks, restore-time privacy/authority reconciliation, and an explicit blocked state. A generic status projection must not clear quarantine, re-enable restored credentials, or claim restore success. |
| SaaS provisioning/onboarding | `server/src/services/saas/onboarding.ts`, onboarding run records and `company_onboarding_runs` | Keep onboarding's idempotent company-creation and staged onboarding owner. It is not a restore/import operation. Revisit projection only if customers need durable cross-session status beyond the existing onboarding receipt. |

The migration rule is additive: keep authorization, idempotency keys, state
transitions, retries, and audit evidence in the originating domain. A future
shared projection may reference an immutable native operation ID, expose only
approved customer-safe state, and link to the existing owner. Never copy raw
operation rows, storage references, provider errors, credentials, private
source details, or administrative restore decisions into a shared envelope.

This is a source-owner design decision, not an end-to-end operation test or
release qualification. Each domain's existing targeted tests and production
recovery evidence remain independently required; no generic envelope test can
stand in for them.
