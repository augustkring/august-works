# Better Auth 1.7.7 security upgrade evidence

Evidence date: 2026-10-28. This records the dependency security update and the account-key migration required by the upstream 1.7.3+ model. It does not establish production-database preflight, deployment, or customer SSO qualification.

## Dependency and audit

The server now pins `better-auth`, `@better-auth/core`, `@better-auth/passkey`, `@better-auth/scim`, and `@better-auth/sso` to 1.7.7. The UI pins `better-auth` and `@better-auth/passkey` to 1.7.7. `@better-auth/utils` remains 0.4.2; the lock resolves `@better-fetch/fetch` 1.3.2 for the 1.7.7 peer. The existing SCIM session-deletion patch is retained at `patches/@better-auth__scim@1.7.7.patch`.

This removes the reported vulnerable 1.7.2 family for [critical GHSA-965c-763c-88jm](https://github.com/better-auth/better-auth/security/advisories/GHSA-965c-763c-88jm) and [high GHSA-r4xp-prcw-77qf](https://github.com/better-auth/better-auth/security/advisories/GHSA-r4xp-prcw-77qf). The patched release separates OAuth state cookies/payload keys and verification identifiers for the affected Magic Link, OAuth and SAML flows. It also moves the Drizzle rate-limit concurrency fix into the synchronized 1.7.7 release.

The captured production audit JSON reports 12 findings (4 low, 8 moderate, 0 high, 0 critical). Pinned pnpm's plain CI command, `/workspace/v10-preparation/pinned-bin/pnpm audit --prod --audit-level high`, exited 0. The separate JSON-mode invocation returned exit 1 despite the JSON containing no high or critical findings; both exact outputs and exit codes are retained below.

## Account-key transition

Better Auth 1.7.7 removes the 1.7.0–1.7.2 `issuer` field from its account model and resolves accounts by `(provider_id, account_id)`. See the upstream [1.7 upgrade guide](https://better-auth.com/docs/guides/1-7-upgrade-guide), especially “Account identity keeps the provider key” and “Check for duplicate account keys.” The application’s 0230 migration had made `issuer` required and unique with `account_id`, so 0558 keeps its historical values but makes it nullable, removes the obsolete issuer index, and adds a unique provider/account index.

Before changing indexes, 0558 rejects any existing duplicate `(provider_id, account_id)` pair with an explicit error. It performs no account merge, provider-ID reassignment, or issuer-data rewrite. A production migration that encounters a duplicate stops; an operator must investigate and assign a distinct provider ID where the identity providers are distinct, then retry. The database’s unique index also blocks concurrent duplicates after cutover. Enterprise SSO separately checks the verified issuer and explicit issuer/subject binding before linking, and requires the existing account to match the selected user.

## Verification

The database schema/migration was generated through the repository’s official workflow in an isolated copy using pinned pnpm 9.15.4 (`pnpm run generate`). Generation temporarily pruned old snapshots only inside that copy; the original snapshots were restored there, and the generated 0558 snapshot was copied back. The 0558 snapshot’s `prevId` matches the current 0557 snapshot.

The pinned database checks passed:

- `pnpm run check:migrations` — migration numbering and safety passed.
- `pnpm run typecheck` from `packages/db` — passed.
- `packages/db/src/better-auth-account-issuer-migration.test.ts` — 2/2 passed. The integration fixture applied the full history, verified preserved legacy issuer values, nullable issuer, removal of the old index, and the new unique index. It also recreated the legacy index in a rolled-back transaction, inserted a cross-issuer collision under the same provider/account key, and executed the exact 0558 preflight, which rejected the ambiguous row set.

Runtime auth suites were run against extracted published Better Auth 1.7.7 family tarballs, not the workspace’s still-installed 1.7.2 node_modules. The archived Vite resolver maps Better Auth family imports to `/tmp/blentera-auth-family-177/<package>/package`; the archived Node loader resolves nested imports the same way. Their exact source bytes and every tarball SHA-256 are listed in `runtime/logs`. No workspace install was performed. The controlled command covered:

`better-auth.test.ts`, `v6-saas-auth.integration.test.ts`, `v7-enterprise-scim.integration.test.ts`, `v7-enterprise-identity-bridge.test.ts`, `native-two-factor.integration.test.ts`, and `better-auth-credential-signup.integration.test.ts`.

An earlier six-suite result reported 71/71 in the tool session, but its raw output was not saved and is not archived as a log. The captured controlled rerun is a distinct attempt: it passed 71/71 tests across all six suites, with stdout and exit code retained. This included real credential signup/sign-in with nullable legacy issuer, qualified SAML start plus forged/foreign-provider rejection, issuer/subject bridge negatives, and simultaneous TOTP consumption. The passing enterprise SCIM integration file includes the regression that retains global sessions and other-company memberships during company-scoped deprovisioning. The TOTP replay guard remains an atomic conditional update on `two_factor.totp_replay_state`; the focused concurrency test also passed separately. An intermediate broad run had a TOTP failure; the captured rerun and focused concurrency run passed.

The captured test resolver maps `@better-auth/scim` to the extracted `@better-auth/scim@1.7.7` package. The module hash and patch evidence in [scim-loaded-package-verification.log](runtime/logs/scim-loaded-package-verification.log) show that this loaded module includes the repository’s session-retention change: its bytes match a separate extraction of the same package tarball after applying the exact 1.7.7 patch.

The captured run is pinned to [revision e2027c4d](runtime/logs/tested-revision.pretest.txt). Its raw six-suite log [passes 71/71](runtime/logs/auth-six-suite.log) with [exit 0](runtime/logs/auth-six-suite.exit); the DB typecheck [exited 0](runtime/logs/db-typecheck.exit); and the migration integration log [passes 2/2](runtime/logs/db-account-migration.log) with [exit 0](runtime/logs/db-account-migration.exit). The production audit JSON is [here](runtime/logs/prod-audit.json), with its [returned exit 1](runtime/logs/prod-audit.exit); the matching plain CI output is [here](runtime/logs/prod-audit-text.log), with [exit 0](runtime/logs/prod-audit-text.exit).

Pretest source/lock/package hashes, the extracted family tarball SHA-256 manifest, and the exact Vite resolver/Node loader copies are archived under [runtime/logs](runtime/logs) and [runtime](runtime). The JSON-mode audit exit is retained as returned rather than relabeled as a pass.

The direct server TypeScript check was attempted and remains blocked by unrelated current-source diagnostics at `server/src/routes/trust-documents.ts:305` (TS18004, undefined shorthand `userId`) and `server/src/services/analytical-context-authority.ts:154` (TS2322, `void | boolean` returned where `void` is required). The database TypeScript check is clean; these server diagnostics are not represented as passed.

The production database’s duplicate-key preflight has not been run here. The migration guard is fail-closed pending that target-specific result.
