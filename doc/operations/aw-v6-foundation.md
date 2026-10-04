# V6 SaaS foundation configuration

This foundation is closed by default. It does not qualify a production service. Public signup, verification/reset email, durable customer onboarding and commercial billing are not yet implemented.

Production qualification must also review existing local agent execution and plugin/environment bootstrap paths for the pooled service. Selecting the SaaS profile does not provide the hosted runtime isolation that later infrastructure and runtime waves must implement.

## Profiles

`AW_DEPLOYMENT_PROFILE` selects `local`, `legacy_managed_stack` or `saas`. It is separate from `PAPERCLIP_DEPLOYMENT_MODE` (`local_trusted` or `authenticated`). An absent profile preserves existing local/legacy behavior. An explicit local/SaaS profile rejects legacy Cloud tenant credentials or `PAPERCLIP_MANAGED_CONFIG`; do not use a profile to weaken a Cloud floor.

SaaS selects authenticated/public mode, an explicit HTTPS Better Auth URL and secure host-only cookies. Cloud control, identity assertion and portfolio proxy routes are absent. Workspace-handoff authentication is absent. The product company directory and live subscriptions require membership, including for instance admins. Existing company creation remains operator-only until the durable onboarding slice replaces it.

Managed child/worktree services strip inherited `AW_` configuration, just as they strip parent `PAPERCLIP_` configuration. A child must not inherit the parent's SaaS profile, public origin or platform credentials. Explicit service overrides are still applied after sanitization.

## Origin source

Use `deploy/v6/saas.env.example` or `deploy/v6/staging.env.example` as configuration references. `AW_PUBLIC_APP_ORIGIN` is required in SaaS. Only HTTPS origins are accepted; paths, query strings, fragments, user information and wildcards are invalid. `AW_ALLOWED_APP_ORIGINS` and `AW_LEGACY_APP_ORIGINS` are comma-separated explicit origins. Legacy entries must not duplicate normal allowed entries.

Additional/legacy origin serving requires both `saas_deployment_profile_v6` and `domain_dual_origin_v6`. Until then, only the primary origin is active. Allowed origins remain HTTPS; being in the allowlist does not permit cross-origin browser session mutations. Changing the primary origin changes newly generated action URLs; it does not move cookies across domains or redirect sensitive token routes.

Old public/auth/API URL environment variables may be absent or equal the configured primary origin. A conflicting value is a startup error. `BETTER_AUTH_TRUSTED_ORIGINS` cannot widen the active allowlist. OAuth/provider callback inventories and full domain rehearsal are later work.

## Proxy contract

For Caddy on the same VM, set `TRUST_PROXY=loopback`. For a separate proxy, specify only the actual immediate proxy IP/CIDR. SaaS rejects unset/false trust, trust-all, hop counts, all-address CIDRs and broad named private/link-local ranges. The network must prevent customers from reaching an address that the app treats as the trusted proxy.

Caddy must preserve the public Host and overwrite forwarding headers with the actual protocol and peer information. HTTPS terminates at Caddy and WS upgrade passes through. API and WS checks both require a configured HTTPS authority. Untrusted direct clients cannot use forwarded host/protocol as authority; untrusted forwarding headers are removed before authentication. Internal health probes must use the configured Host and the trusted proxy's HTTPS protocol contract. Do not exempt public health routes from host checks.

## Rollout

All 18 V6 flags are persisted through the existing operator-only instance experimental settings API. Their catalog is `packages/shared/src/v6-feature-flags.ts`. Each has owner, default, scope, dependencies, rollback, removal condition and review date.

Before starting a SaaS profile against an existing DB, an authorized operator can set `saas_deployment_profile_v6=true` through the existing local/authenticated instance administration path. A fresh installation needs the same reviewed settings bootstrap before SaaS admission. Do not enable implicit public local access to seed it. No new tenant feature flag API exists.

The profile gate is read before listening. Disabling it requires a restart to close the service; it never converts the running process to local authority. Origins are also a startup snapshot; restart after changing origin/gate settings. Other V6 flags are contracts for future implementations, not working capabilities. Signup remains disabled in this slice regardless of `saas_self_signup_v6`.

## Verification

From `packages/shared`, run `pnpm exec vitest run src/v6-feature-flags.test.ts src/feature-catalog.test.ts`.

From `server`, run the V6 config/origin tests plus existing auth, Cloud-floor, instance settings and company authorization tests. The origin fixture performs actual HTTP/WS handshakes and checks wrong-origin and wrong-company denials. These tests do not send real email or provision a VM.

Before handoff, run repository typecheck, test partitions, build, token/security/pilot static gates and migration checks. Record any unrun or failed gate explicitly. Real Caddy, TLS, managed DB/S3 and paid-provider deployment qualification remains pending.
