# Better Auth 1.7.7 security upgrade evidence

Evidence date: 2026-10-28. This records the dependency security update and the account-key migration required by the upstream 1.7.3+ model. It does not establish production-database preflight, deployment, or customer SSO qualification.

## Dependency and audit

The server now pins `better-auth`, `@better-auth/core`, `@better-auth/passkey`, `@better-auth/scim`, and `@better-auth/sso` to 1.7.7. The UI pins `better-auth` and `@better-auth/passkey` to 1.7.7. `@better-auth/utils` remains 0.4.2; the lock resolves `@better-fetch/fetch` 1.3.2 for the 1.7.7 peer. The existing SCIM session-deletion patch is retained at `patches/@better-auth__scim@1.7.7.patch`.

This removes the reported vulnerable 1.7.2 family for [critical GHSA-965c-763c-88jm](https://github.com/better-auth/better-auth/security/advisories/GHSA-965c-763c-88jm) and [high GHSA-r4xp-prcw-77qf](https://github.com/better-auth/better-auth/security/advisories/GHSA-r4xp-prcw-77qf). The patched release separates OAuth state cookies/payload keys and verification identifiers for the affected Magic Link, OAuth and SAML flows. It also moves the Drizzle rate-limit concurrency fix into the synchronized 1.7.7 release.

The pinned command `/workspace/v10-preparation/pinned-bin/pnpm audit --prod --audit-level high` exited 0 on the updated workspace. It reported 12 remaining vulnerabilities, all below the threshold (4 low, 8 moderate); no high or critical findings were returned.

## Account-key transition

Better Auth 1.7.7 removes the 1.7.0–1.7.2 `issuer` field from its account model and resolves accounts by `(provider_id, account_id)`. See the upstream [1.7 upgrade guide](https://better-auth.com/docs/guides/1-7-upgrade-guide), especially “Account identity keeps the provider key” and “Check for duplicate account keys.” The application’s 0230 migration had made `issuer` required and unique with `account_id`, so 0558 keeps its historical values but makes it nullable, removes the obsolete issuer index, and adds a unique provider/account index.

Before changing indexes, 0558 rejects any existing duplicate `(provider_id, account_id)` pair with an explicit error. It performs no account merge, provider-ID reassignment, or issuer-data rewrite. A production migration that encounters a duplicate stops; an operator must investigate and assign a distinct provider ID where the identity providers are distinct, then retry. The database’s unique index also blocks concurrent duplicates after cutover. Enterprise SSO separately checks the verified issuer and explicit issuer/subject binding before linking, and requires the existing account to match the selected user.

## Verification

The database schema/migration was generated through the repository’s official workflow in an isolated copy using pinned pnpm 9.15.4 (`pnpm run generate`). Generation temporarily pruned old snapshots only inside that copy; the original snapshots were restored there, and the generated 0558 snapshot was copied back. The 0558 snapshot’s `prevId` matches the current 0557 snapshot.

The pinned database checks passed:

- `pnpm run check:migrations` — migration numbering and safety passed.
- `pnpm run typecheck` from `packages/db` — passed.
- `packages/db/src/better-auth-account-issuer-migration.test.ts` — 2/2 passed. The integration fixture applied the full history, verified preserved legacy issuer values, nullable issuer, removal of the old index, and the new unique index. It also recreated the legacy index in a rolled-back transaction, inserted a cross-issuer collision under the same provider/account key, and executed the exact 0558 preflight, which rejected the ambiguous row set.

Runtime auth suites were run against extracted published Better Auth 1.7.7 family tarballs, not the workspace’s still-installed 1.7.2 node_modules. A temporary Vite resolver at `/tmp/blentera-auth-vitest.config.mjs` maps every Better Auth family import to `/tmp/blentera-auth-family-177/<package>/package`; `/tmp/blentera-auth-family-loader.mjs` resolves nested Node imports the same way. No workspace install was performed. The controlled command covered:

`better-auth.test.ts`, `v6-saas-auth.integration.test.ts`, `v7-enterprise-scim.integration.test.ts`, `v7-enterprise-identity-bridge.test.ts`, `native-two-factor.integration.test.ts`, and `better-auth-credential-signup.integration.test.ts`.

The final run passed 71/71 tests across all six suites. This included real credential signup/sign-in with a nullable legacy issuer, qualified SAML start plus forged/foreign-provider rejection, issuer/subject bridge negatives, and simultaneous TOTP consumption. The TOTP replay guard remains an atomic conditional update on `two_factor.totp_replay_state`; the focused concurrency test also passed separately. One earlier broad run had a transient TOTP failure, so the passing controlled full-suite rerun is the current evidence.

The direct server TypeScript check was attempted and remains blocked by unrelated current-source diagnostics at `server/src/routes/trust-documents.ts:305` (TS18004, undefined shorthand `userId`) and `server/src/services/analytical-context-authority.ts:154` (TS2322, `void | boolean` returned where `void` is required). The database TypeScript check is clean; these server diagnostics are not represented as passed.

The production database’s duplicate-key preflight has not been run here. The migration guard is fail-closed pending that target-specific result.
