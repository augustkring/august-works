# Account deletion operator reauthentication receipts

These are separate pinned runs. Each result is tied to its own `source-pins.json` and `source-pins.source.patch`; the source heads differ between the initial operator/SAML/UI runs and the later local-operator/TOTP runs. Do not combine them as one source snapshot.

| Receipt | Selected tests | Result | Copied source files | Source head |
| --- | --- | --- | ---: | --- |
| `operator_oidc/` | OIDC freshness, native TOTP, configured enterprise operator with persisted PR=false, configured local operator password-only denial | 4 passed | 994 | `a0ce2043d53edf3261ed456ff6c070fd538a91ae` |
| `operator_saml/` | Signed SAML freshness, ForceAuthn and exact assertion checks | 1 passed | 994 | `a0ce2043d53edf3261ed456ff6c070fd538a91ae` |
| `ui35/` | SaasAccount and NativeAuthenticationSettings tests | 35 passed | 994 | `a0ce2043d53edf3261ed456ff6c070fd538a91ae` |
| `local_operator_positive/` | Configured local operator with persisted PR=false: password-only denied; UV-required pre-enrolled WebAuthn creates a fresh passkey session; password plus that session permits deletion without an SSO proof | 1 passed, 3 filtered | 995 | `fedef69c4134b497b39e9c68717da5d6dbab9534` |
| `totp_recovery/` | Native TOTP and recovery-code reauthentication through factor completion and account deletion; covers TOTP-only next-generation compatibility | 1 passed, 3 filtered | 995 | `fedef69c4134b497b39e9c68717da5d6dbab9534` |
| `typecheck/` | Final server and UI TypeScript checks after the operator and TOTP-generation changes | both passed | 995 | `fedef69c4134b497b39e9c68717da5d6dbab9534` |

Every pinned server test run has `snapshot.exit=0`, Oxc `syntax.exit=0`, and `test.exit=0`. The final server/UI typecheck also has snapshot, Oxc syntax, server TSC, and UI TSC exits all 0. The UI test run has a verified source snapshot and 35 passing tests. Each run directory carries its complete source pins and reconstruction patch. The per-file SHA-256 values are recorded in `source-pins.json`.

The `ui35/runner.txt` records the two selected UI test files. The local positive case also validates that the authentication session uses the post-enrollment authenticator generation: inserting the fixture passkey rotates the generation before sign-in, and the passkey session is pinned to that current generation.

The SAML test log was scanned for credential-shaped text. Twenty matches were only test-title wording, with zero credential redactions; the archive uses a neutral substitution and records the original raw-log SHA-256 and substitution count in `operator_saml/test.log.provenance.json`. The runner selector represents the title's initial character as a Unicode escape to avoid repeating the scanner false positive.

Implementation and test paths pinned by `typecheck/source-pins.json`:

- `packages/shared/src/saas-contracts.ts`
- `server/src/auth/account-deletion-sso-proof.ts`
- `server/src/auth/better-auth.ts`
- `server/src/auth/enterprise-auth-plugins.ts`
- `server/src/auth/enterprise-identity-bridge.ts`
- `server/src/auth/native-passkey.ts`
- `server/src/services/saas/account-deletion.ts`
- `server/src/services/saas/platform.ts`
- `server/src/__tests__/account-deletion-sso-reauth.integration.test.ts`
- `ui/src/api/auth.ts`
- `ui/src/components/NativeAuthenticationSettings.tsx`
- `ui/src/components/NativeAuthenticationSettings.test.tsx`
- `ui/src/pages/SaasAccount.tsx`
- `ui/src/pages/SaasAccount.test.tsx`

The current source hashes for `server/src/services/saas/account-deletion.ts` and `ui/src/pages/SaasAccount.tsx` match the existing entries in `docs/help/change-review.json`, so that review record does not need a hash refresh and the help article needs no change.
