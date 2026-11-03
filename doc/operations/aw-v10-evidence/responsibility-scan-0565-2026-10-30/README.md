# 0565 responsibility completion review bundle

This bundle contains the exact 35 files published for 0565, with their SHA-256 values, the single official migration snapshot prune, and qualification receipts. `payload/` stores the published source contents relative to repository root. `stage-0565.sh` stages only those 35 paths and the required deletion of `packages/db/src/migrations/meta/0560_snapshot.json`; it does not commit.

## Qualification

- Native responsibility/ACL/contact/offboarding integration: 16/16 passed. See `evidence/pg-16-of-16.log`.
- Full server TypeScript check passed on the current source snapshot. The UI-only follow-up receipt records that all responsibility server/DB/shared overlay hashes stayed unchanged; it reran server TSC against the current Native `native-direct-input.ts` hash. See `evidence/server-typecheck.log` and `evidence/ui-hash-equivalence.json`.
- Company Settings UI tests: 10/10 passed; UI `tsc -b` passed. See `evidence/ui-10-of-10.log` and `evidence/ui-typecheck.log`.
- Official migration generated from the published 0564 journal/snapshot, then built and applied in embedded PostgreSQL; the test verified the new contact columns, scan tables and constraints (1/1). See `evidence/generated-migration-pg.log`, `evidence/generated-migration-manifest.json`, and `evidence/migration-restore.json`.
- Post-publication check passed: Oxc 1,002 files, all 35 published hashes, exactly one official snapshot prune, `check:migrations`, and `git diff --check`. See `evidence/post-publication-result.json`.
- Baseline DB/shared clean+build restoration passed. The migration validation runner restored the baseline migration tree with 573/573 hashes matching.

The earlier UI run `023405` had 9/10 passing before its selector/wait fix; the final UI receipt above is the corrected 10/10 run. Use only the final receipts listed above.

## Root review pointers

- Native-kind readers and current source metadata/get/version/ACL checks: `payload/server/src/services/experience/private-0565/native-metadata-sources.ts` and `native-reader-adapters.ts` (17 registered kinds are assembled at lines 486-497).
- Classification and source-bound resolution: `payload/server/src/services/experience/private-0565/authorized-subset-reader.ts` (complete required-kind list at 28-32; native read/filter and `MUST_REASSIGN` / authorized-group / temporary-unowned handling at 34-94). Specific classifications are assigned in `native-reader-adapters.ts` and never grant source actions.
- Privacy boundary: `authorized-subset-reader.ts` resolves cached `(company, kind, resource ID, version)` pointers with fresh native reads, omitting hidden/missing/stale rows; `responsibility-scan-store.ts` persists pointer metadata, not source titles, owners, payload, or ACL. Support case rows use the customer getter, and platform operator coverage remains separate.
- Existing SaaS scheduler integration and bounded fair work: `payload/server/src/services/experience/private-0565/maintenance-runner.ts`, `payload/server/src/services/experience/private-0565/responsibility-scan-store.ts`, and `payload/server/src/services/saas/platform.ts`.
- Optional security/support incident contact settings, owner-only settings API, active verified same-company Humans, and labels with no permission authority: `payload/server/src/services/company-responsibility-contacts.ts`, `payload/server/src/routes/companies.ts`, and `payload/ui/src/pages/CompanySettings.tsx`.
- Offboarding fence: `payload/server/src/services/saas/account-deletion.ts` clears/revokes synchronously in its native transaction and enqueues after commit with failures caught so they cannot restore access; periodic scan remains due.
- Tests: `payload/server/src/__tests__/private-0565-responsibility-scan.integration.test.ts`; generated DDL apply test was ephemeral and is represented by its preserved test log and generated migration manifest.

## Migration identity

The official migration is `packages/db/src/migrations/0565_first_gorgon.sql`; journal index 565; snapshot `0565_snapshot.json` chains from published 0564. The retired `0560_snapshot.json` is the only snapshot pruned. Exact current source and migration hashes are in `source-hashes.sha256` and `manifest.json`.

## Follow-up source review fixes

The r2 payload includes two verified corrections after the first publication receipt: retry attempt count now uses the value atomically incremented and returned by claim (`maxAttempts=4` means exactly four claims), and offboarding clears default/security/support-contact fields independently so unrelated holders remain assigned. The real PostgreSQL suite passed 17/17, including exact retry/backoff bounds and distinct-holder offboarding. Fresh full server typecheck and Oxc 1,002-file parse passed. The corresponding fresh-source receipts are named `followup-*` in `evidence/`. `source-hashes.sha256` and `manifest.json` hash the exact current 35 stage paths.
