# Blentera V10 — Native authentication completion

Status: implementation in progress. Maintained TOTP/recovery is enabled with
native session assurance and configured-origin UV passkeys. Complete CE-03
admission, operator effect fences and enterprise completion remain open. This
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

## Initial evidence limits (before the dated checkpoints)

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


### 2026-10-24 — verified TOTP consumption survives session failure

The original verifier's accepted same-code replay is now fenced by bounded
fingerprints on the existing native factor row. Migration 0523 adds only that
private metadata and its 16-entry bound. A successful maintained verification
consumes the fingerprint under the actual user/factor generation in an independent
physical transaction. The 90-second database-time window covers the provider's
current/adjacent 30-second steps. Password and backup-code rotation preserve this
state because neither replaces the TOTP secret. Factor erasure removes it. Old
fingerprints expire for replay matching and are pruned on use; bounded retained
security metadata is not a claim of physical removal exactly at expiry.

Session creation repeats the current user/factor check and retains the original
verification time. It cannot roll code consumption back on a later native write
failure. Existing in-session TOTP confirmation also uses the shared physical
session proof pin during completion. Simultaneous true native challenges grant
one completion for one valid code. A real native session-write failure still
leaves the code consumed. Original replay baseline: one case/three assertions
fail; first-stage rollback baseline: one case fails. Staged complete suites pass
46, then47, then48 cases; final server compiler and migration checks return zero.
Exact stages: `native-totp-replay-2026-10-24/checkpoint.json`.

This closes the bounded software same-code consumption regression identified in
the previous checkpoint. Account settings/enrollment UX, expected-principal
request binding, passkeys/operator bootstrap, enterprise recovery, other
sensitive-action owners, production clock/replica and full V10 admission remain
open. Existing native verifiers are retained; no custom OTP verifier is added.


### 2026-10-24 — native authenticator account settings and response binding

The personal security page now uses the maintained TOTP/recovery owner for
setup, first verification, one-time recovery-code display, recent confirmation,
replacement recovery codes, disabling with forced sign-out, and cancelling an
unverified setup. English and Danish copy use the existing design tokens. The
settings card is independent of paid SaaS capabilities. Passwordless enterprise
setup and passkey/operator confirmation remain explicitly unavailable here.

Optional expected-user/session headers narrow the actual cookie or first-factor
principal. Native setup/code/completion responses include the actual replacement
session ID. The browser verifies the canonical response and that exact current
native source before showing a private result. A late response for another user
or session is discarded. Cancellation retains only its original session ID for
retry: an absent original factor is a safe no-op; a newer pending enrollment is
not removed by an old retry. Verified factors cannot use this cancellation path.

The built-browser regression exposed the original `/get-session` route's
synthetic per-user ID. Native actors now receive their actual native session ID;
missing native identity is refused. Local implicit/cloud provenance keeps its
separate representation. The route/middleware suites pass38 cases. A subsequent
browser run exposed status requests racing cookie rotation and a session-cache
refresh interrupting a valid multi-step action. Background native status reads
are cancelled/held during changes. Each refresh reads a new canonical response;
following native writes use the verified response's session ID. Private rendering
still waits for the current idle account cache and exact session match.

A complete Chromium151 run against the production UI build and migrated native
PostgreSQL passes setup, actual maintained TOTP, fresh confirmation/session
rotation, real one-use recovery verification, code replacement, disabling,
sign-out/new password sign-in and pending cancellation. It uses real HTTP-only
cookies and no API route mocks. Trace/screenshots are disabled for these private
ceremonies. This is disposable private-instance software evidence, not SaaS mail,
external IdP, passkey/hardware, deployed replica or host qualification. The
separate checkpoint records compiler/UI/native suite results and source hashes.
Full CE-03, powerful-action/operator guards and full V10 admission remain open.


### 2026-10-24 — maintained passkeys, one-use ceremonies and private failures

The existing Better Auth/passkey1.7.2 owner now supports local-account key
registration, full sign-in, current confirmation, bounded summary listing,
renaming and removal. The fixed configured origin/RP is independent of request
headers. HTTPS DNS origins and localhost development are supported; IP addresses
are not advertised as passkey RPs. English/Danish controls stay outside paid
capability gates. Private summaries omit credential public keys, credential IDs
and counters. Device private keys remain with the authenticator.

Both native verifier callbacks require their actual verified UV flag. An
AsyncLocalStorage ceremony context transfers only trusted pre-verification user,
operation and credential facts; browser metadata cannot assert successful UV.
The real user/generation/key and current native session are pinned in the same
physical mutation transaction. Generation is captured before verification.
Registration retains the genuine preceding authentication event/time, rather
than claiming that registration or session creation was MFA. Actual verified
passkey authentication alone stamps a fresh passkey event using the database
clock. Key removal revokes native sessions and requires new sign-in; deleting the
last required key remains blocked by both the controller and native DB guard.

The provider's atomic challenge consume commits before the protected mutation.
Its exact consumed row is handed once to the unchanged maintained verifier inside
the transaction. Failed database work or process loss cannot restore it. No
verification row is recreated. Registration challenges also bind the actual
original session/generation through server-owned provider context. A newer native
session cannot repurpose an old enrollment, and client-supplied context/name does
not select the registration identity. Known-credential attempts use the existing
durable native budget with a current-user lifetime fence; erasure removes it.

Enterprise-bound users are deliberately withheld from this local passkey path
until the existing enterprise policy/verified-identity owner can qualify their
recovery and first-factor lifetime. SaaS email-verification requirements are
also checked at the actual native proof pin. Operator authentication can retain
the private phishing-resistant requirement after genuine UV; this does not grant
an operator role or close operator domain-effect admission.

Actual built-app Chromium ceremonies cover successful creation, current
confirmation, rename, anonymous passkey sign-in, removal/sign-out and password
fallback. Client-weakened creation/authentication options produce real WebAuthn
responses without UV; the server refuses both and refuses their replays. A
fixture-user-specific native PostgreSQL trigger rejects replacement-session
insertion after real successful WebAuthn verification/key writing. A
nontransactional test sequence proves that exact point was reached. The key,
generation and session mutation roll back, the genuine prior password session
survives, and the consumed challenge remains unusable. All SQL fault controls
exist only in the isolated Playwright database and are removed in finally.

The browser also found SDK Date revival and raw-SQL timestamp mismatches. The
SDK preserves the wire JSON contract and list reads use the existing typed
Drizzle schema. Read-only key listing takes a shared user pin. A private key label
is sent in the verification body and removed from the SDK's redundant options
GET query. Private HTTP logging now covers the entire native auth namespace,
including failures and unexpected methods. Intent headers are redacted. SDK logs
retain static structured event metadata, while the supported API-error hook
normalizes unhandled/server errors before the lower router can print exception
arguments. Native session-resolution errors do not forward driver/token details;
unknown session lookup returns503 instead of being treated as signed-out.

Evidence and exact final gate counts are recorded at
`doc/operations/aw-v10-evidence/native-passkeys-2026-10-24/checkpoint.json`.
These are software/emulated-authenticator results, not hardware, deployed
replicas/restarts, mail/IdP, representative Human or production-host qualification.
All remaining V10/PR gates stay open.

### Next operator admission owner work

Preserve the actual AuthorizationActor instead of reducing authenticated requests
to bare user IDs. Repeat configured-operator membership, native session lifetime
and phishing-resistant proof in the original effect transaction. Admission
middleware alone cannot fence a later committed write. Existing seams are
`pinCurrentBoardActor` and `assertHumanAuthentication`; tenant permissions, owner
approval, operation receipts and explicit scheduler/service lanes remain separate
requirements.

Concrete owners: instance-settings routes/services; execution-sandbox service
mutation transactions; SaaS support, runtime catalog/fleet/control and billing
cost services; enterprise qualification; agent-package publication/revocation;
and feedback triage/retention/internal reads. The retained Luna audit identifies
that support/feedback already repeat domain/user checks, but still lack a native
session/MFA pin. Queue/provider effects must keep their existing operation and
unknown-outcome owners while carrying genuine current authority; a stored
operator ID or source snapshot is not a fresh permission grant.

### 2026-10-24 — configured-operator native proof in domain transactions

This bounded CE-03/CE-04 increment preserves V10-166 and the original instance
settings, enterprise identity, execution sandbox and native support owners.
`assertConfiguredOperatorAuthentication` composes the existing native proof
kernel with configured operator membership and verified email. Its SQL pins the
actual user/session, credential generation and database-clock proof lifetime;
Board tokens, implicit actors, bare session labels and password-only sessions
cannot substitute for passkey authentication. It grants no company permission,
resource access or support approval.

Enterprise qualification checks current recent proof inside its original policy
transaction and repeats it after secret/key work before publication. Sandbox
binding/qualification/reconciliation/policy transactions repeat the native
operator check alongside their existing tenant and resource checks. Private
sandbox configuration reads use actual transactions with current proof. The
ordinary tenant posture projection remains separate. A real PostgreSQL row-lock
wait test deletes the original session before binding creation resumes and
proves that no binding commits.

SaaS instance settings repeat recent proof before and after writes using the
original transaction; general updates accept the same optional runner as the
other settings writers. Operator settings/lifecycle/drain reads pin current
proof through their original reads. Non-SaaS administrator behavior is preserved.
Drain start/stop keep serialized audit-commit-before-process-state ordering.
Their post-commit in-memory effect cannot be atomic with the database proof pin;
durable drain-state ownership remains unresolved rather than claimed closed.

Support status/backup/override/runtime/canary calls retain the actual actor from
SaaS routes. The original support authorization owner checks that actor within
the original transaction, then retains exact support session, scopes, approval
expiry and current approving owner. Private reads require current passkey proof;
mutation/request admission also requires recent proof. Checks repeat before
commit, including idempotent returns. Support approval expiry uses database time,
so a stale call-start timestamp cannot revive it. Owner-facing review, approval
and revocation keep their separate authority and receipts.

Compatibility: no migration or dependency is added. Internal support callers now
pass an AuthorizationActor rather than a user ID. Native structural test rows
exercise domain admission, not WebAuthn/cookie verification; the separate built
browser checkpoint qualifies maintained ceremonies. Exact checks/source hashes
are retained at
`doc/operations/aw-v10-evidence/native-operator-admission-2026-10-24/checkpoint.json`.

Remaining operator work includes actual host/provider dispatch and completion
receipts, sandbox host-command requester provenance, runtime catalog/fleet/control,
costs, agent packages, feedback/retention, all other internal reads, and bootstrap/
break-glass qualification. A committed request or stored operator ID is not a
fresh authority grant for a later effect. Enterprise recovery/SSO, other powerful
actions, original source-privacy/typed-origin/portability failures and complete
V10 acceptance/full workspace gates remain open. No PR-ready claim.
