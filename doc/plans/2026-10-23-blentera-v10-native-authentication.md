# Blentera V10 — Native authentication completion

Status: implementation in progress. No MFA/passkey plugin is enabled yet. This
plan implements CE-03 in the V10 rev4.0 brief through the existing Better Auth
1.7.2, account, session, enterprise and authorization owners. It confers no pilot,
operator, provider or hardware qualification.

## Existing owners and boundaries

- `server/src/auth/better-auth.ts`: Better Auth configuration, native auth
  endpoints, password policy, verified mail and enterprise plugins.
- `packages/db/src/schema/auth.ts`: original native user/session/account and
  verification models; generated migrations remain authoritative.
- `ui/src/api/auth.ts`, `ui/src/pages/Auth.tsx`: native sign-in and challenge;
  preserve validated intended/invitation return paths.
- `ui/src/pages/SaasAccount.tsx`: enrollment, factors, recovery and current
  sessions, within its existing principal/session invalidation boundary.
- `server/src/middleware/auth.ts`: current human identity. Powerful domain
  operations must repeat current credential/factor admission in their original
  transaction; a UI flag cannot grant authority.
- `server/src/services/saas/account-deletion.ts`: destructive account action.
- `server/src/auth/enterprise-auth-plugins.ts`: enterprise identity/recovery
  policy. Local factors must not bypass a configured enterprise restriction.
- `saasPlatform.operatorUserIds`: configured platform operators. Existing
  instance administrator and operator permissions remain separate.

## Implementation sequence

1. Preserve native two-factor sign-in responses. Handle a native challenge
   before navigation/session success; support native TOTP and recovery-code
   verification, clear the password and retain the intended return destination.
   Do not offer an unconfigured email/SMS OTP method.
2. Add the exact native `twoFactor` and official `@better-auth/passkey` 1.7.2
   schema/adapter mapping. Keep encrypted secrets and recovery codes out of
   responses, application logging, browser storage, public DTOs and support
   diagnostics. Validate generated upgrade and account-deletion cascades.
3. Configure native plugins only with complete enrollment, verification,
   challenge, removal and recovery UI/API behavior. All baseline customers receive
   the supported methods without a billing entitlement. Preserve passwordless
   enterprise account restrictions rather than inventing a local password.
4. Require fresh native proof for factor binding/removal, recovery-code rotation,
   password/email changes, powerful credentials and destructive actions. Keep
   server-owned session assurance bound to the actual current user, session and
   factor generation; factor changes/recovery invalidate obsolete authority and
   the appropriate sessions. Do not infer MFA from a browser cookie or session
   creation time.
5. Require phishing-resistant proof for platform/operator and break-glass
   authority. Enrollment-only access cannot inherit operator authority. Recovery,
   reset, enterprise bypass and removal of the last qualifying factor cannot
   provide a weaker route to that authority.
6. Run actual HTTP/cookie/native PostgreSQL enrollment/challenge/replay,
   concurrent consumption, factor/session revocation and wrong-origin/account
   cases; then browser WebAuthn/keyboard/password-manager flows. Software virtual
   authenticator evidence is distinct from physical authenticator qualification.
   Finish with the repository-wide typecheck, tests and build.

## Provider details that must remain explicit

The exact published passkey 1.7.2 implementation has native `afterVerification`
callbacks for registration and authentication. Its verifier calls currently set
`requireUserVerification: false`; requesting `userVerification: required` in
browser options alone is therefore insufficient. Enforce the provider's verified
`registrationInfo.userVerified` / `authenticationInfo.userVerified` result in
those native callbacks and pin the canonical
origin/RP ID. Do not implement another WebAuthn verifier or patch node_modules.

The native TOTP enable endpoint preserves an already-verified factor's state
when replacing its secret. Do not expose that call as an unchecked rotation
operation. Existing-factor changes need current factor proof and a complete
replacement/recovery lifecycle. Native backup-code consumption remains one-use;
a lost response cannot authorize a replay.

## Current evidence limits

The earlier password/mail/session checkpoints remain bounded software evidence.
No MFA/passkey activation, supported-method completeness, fresh-factor assurance,
operator phishing resistance or complete CE-03 qualification follows from this
plan or the client challenge integration alone. Actual provider delivery, DNS,
region and deployment evidence remain separate V6 admission requirements.

## Password proof and lifetime implementation (2026-10-24)

The final native policy plugin now declares private, non-input user/session
assurance fields and records completed native email/password signup/sign-in.
It runs last, after any native challenge plugin. It accepts only the actual
new native session and its trusted user generation, pins the current user in
PostgreSQL, and stamps the actual session using the database clock. Signup
accounts for its own credential INSERT; sign-in requires an unchanged generation.
A missing, expired or concurrently invalidated session cannot acquire proof.
Historic sessions, reset links, cookie refresh and SSO are not backfilled.

Generated migrations 0518/0519 add exact provider models and native credential
lifetime guards. Harmless passkey counter/name and TOTP lockout updates preserve
generation. Replacement, removal, recovery-code consumption and password changes
invalidate old proof/sessions. The final qualifying passkey is retained under the
same user lock as competing credential changes. Canonical irreversible account
erasure, including quarantine replay, destroys factors even if its scrubbed user
row must temporarily remain; its deletion marker never grants recovery access.

The UI understands native TOTP/recovery challenges and preserves invitation and
return navigation. MFA/passkey plugins, enrollment/removal UI, native factor proof
completion, recent-action enforcement and operator admission are still pending.
The current password proof does not qualify CE-03 as complete and does not grant
membership, company permission or operator status.

## Remaining native transaction boundary

Recent proof for factor binding/removal must pin the actual native mutation's
physical transaction. A before-hook probe followed by an independently committed
provider write leaves a revocation race. Keep the maintained provider's verifier,
adapter and session/cookie owner; do not add another verifier or session engine.

Native TOTP failed-attempt/lockout updates and consumed WebAuthn challenges must
survive rejected ceremonies. Wrapping an entire verification endpoint in a
transaction that rolls those mutations back would weaken the provider. Exercise
that negative case explicitly before enabling methods. The provider exports
`runWithAdapter` / `runWithTransaction`; transactional adapter binding must keep
both direct `ctx.context.adapter` calls and native internal-adapter calls on the
same actual transaction, and publish cookies only after commit. Registration
challenge consumption remains one-use even when a protected mutation rolls back.

Account confirmation accepts the full supported UTF-16 bound at the shared
validator and input, while the maintained password verifier checks the original
untrimmed value. New-password policy remains 15–128 Unicode codepoints; this does
not prevent existing shorter credentials from being confirmed or upgraded.

Passkey registration verification values contain JSON with `type: registration`
and `userData`, including the actual user ID and display metadata. The original
`verification.value = userId` cleanup only reaches TOTP/login values, not these
registration records. Before activating passkeys, bind pending registration to
its original user/session generation and erase its actual stored user data on
factor changes, account erasure and quarantine replay. Cover the native stored
shape and malformed/unrelated verification values without logging their contents.

### Reauthentication integration details

Better Auth 1.7.2 `getSessionFromCtx` assigns the parsed public response back to
`ctx.context.session`; private generation fields are therefore absent from
session middleware. Capture a trusted database generation using the actual
native session/user before password or in-session factor verification, then
fence completion against that captured generation. Never load a new generation
after verification and treat it as the verified one. New native password login
sessions retain their original internal user snapshot and already pass this fence.

Password reauthentication uses the maintained `ctx.context.password.checkPassword`
checker, rotates the original native session, and stamps only completed current
password proof. A per-principal native database budget commits before the verifier;
it must share the actual user/session lifetime pin while reserving, so erasure
cannot be followed by recreation of an identity-linked attempt row. Wrong
passwords cannot roll back attempts. Rate-limited attempts must still commit their
bounded denial state. Deny canonical erasure markers even if stale credential or
session material reappears; restore qualification remains separate.

For protected native configuration endpoints, retain the official endpoint body,
metadata and middleware and execute its handler on a native transactional Drizzle
adapter inside the actual proof-pinned PostgreSQL transaction. The native
`getCurrentDBAdapterAsyncLocalStorage` advanced API can bind direct adapter calls,
internal-adapter calls and pending after-commit hooks to that physical transaction.
Publish native cookie headers and after-commit hooks only after its real commit;
preserve the native endpoint's response/status and separate Set-Cookie headers.
If registration rolls back, independently consume its signed native registration
challenge after rollback so rejection does not restore a one-use nonce.

The provider's fresh-session middleware also checks session creation age. Current
password reauthentication now rotates the session after real completed
reauthentication. The actual PostgreSQL/HTTP regression covers an aged native
session, denial of its old ID, native fresh-session compatibility, rollback of
provider writes and staged cookies, and hooks observing the physical commit. Rotation must never be
counted as the authentication event. Verified enterprise SSO needs its original
qualified callback/policy owner and a real recent identity event for passwordless
factor setup; do not invent a local password or infer strong MFA from an SSO
session cookie.


### 2026-10-24 — native session rotation checkpoint

The existing password-confirmation endpoint now creates its replacement through
Better Auth's maintained internal adapter within the same physical PostgreSQL
transaction as the pre-verification generation fence. It transfers only the
actual password proof and database authentication time, preserving native token,
identifier and creation-time generation. The old session is exclusively locked
and removed; concurrent confirmations cannot both rotate it. Attempt reservations
remain committed independently. The transaction adapter binds native direct and
internal writes, restores staged cookies/session context on rollback, and runs
native hooks after physical commit. No new authentication method is activated.

The complete credential HTTP/PostgreSQL suite passes 14 cases, including an actual
failure after native replacement creation, staged cookie and old-session deletion,
and an after-commit callback reading the committed replacement on an independent
connection. Full MFA, passkey ceremony, enterprise recovery, operator admission and
all V10 release gates remain separate unfinished work.


### 2026-10-24 — typed native challenge lifetime

Native migration 0520 now recognizes the maintained provider's registration and
authentication JSON user identity without treating unrelated verification values
as JSON contracts. It removes those values after credential-generation changes
and native user deletion. The original irreversible erasure owner removes them
when retaining its scrubbed principal. Before storing an owned challenge, a native
trigger pins its actual live user and rejects canonical erasure markers, missing
users or conflicting physical user locks. Anonymous discoverable authentication
carries no user identity and remains available. Malformed and unrelated values
cannot abort cleanup. This does not yet bind generation/session into registration
or activate any factor endpoint.

Three original-product regressions failed before the fix. The three complete
PostgreSQL/HTTP suites now pass 37 cases; native migration checks and server
compiler return zero. Exact evidence is retained under
`native-challenge-lifetime-2026-10-24/checkpoint.json`.


### 2026-10-24 — maintained TOTP/recovery backend

The native two-factor plugin is now composed before the existing final password
assurance hook. Its original verifier, encrypted secrets, account lockout and
backup-code CAS remain in use. A physical transaction fences the original verified
password generation before issuing a native challenge; migrations 0521/0522 bind
its private generation and invalidate unknown historic challenges. Current native
MFA completion fences the captured factor identity/version and rotates its actual
session with database-time proof. A durable per-user verification budget commits
before crypto/completion, including in-session confirmations that the provider's
sign-in-only lockout does not cover. Wrong attempts cannot roll this budget back.

Configuration requires recent actual proof in the same provider transaction.
Enrollment remains pending until real TOTP verification. Enabled-secret replacement
is refused, backup-code rotation preserves the real earlier authentication event,
and disabling forces a new sign-in. Historic trusted-device cookies and
session-skipping recovery do not bypass the factor/challenge. Unconfigured OTP
paths are absent over HTTP. Password changes preserve the actual prior MFA event
under their own credential change; irreversible account exit requires current
recent MFA and an actual same-user native session. Sole ownership, billing and
other original exit blockers remain intact. Account erasure clears factor budgets.

Actual native lifecycle tests first pass 2 cases, then the four complete native
suites pass 42 cases, and the final four suites pass 44 cases after sensitive-action
and current-session integration. Final server compiler and migration checks return
zero. Exact stages and source pins are retained in
`native-two-factor-2026-10-24/checkpoint.json`.

This checkpoint does not qualify TOTP same-code replay inside its valid window;
add an atomic consumption fence while retaining the maintained verifier before
release. Account enrollment/recovery settings UI, full passkey UV and operator
admission/bootstrap, enterprise recovery, other powerful-action guards and overall
V10 admission remain open. Two native auth instances in one process are not a
deployed replica/restart qualification. Server compiler excludes test files.
