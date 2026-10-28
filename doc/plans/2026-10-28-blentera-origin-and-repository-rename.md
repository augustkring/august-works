# Blentera origin and repository rename plan

Status: reversible operator plan; no domain, OAuth, Slack, Teams, deployment,
or GitHub setting was changed by writing this document.

This plan consolidates the work required by V10-010. Current application
identity constants are in `packages/shared/src/product-identity.ts`:
`https://blentera.com`, `https://app.blentera.com`,
`https://docs.blentera.com`, `https://status.blentera.com`, and
`https://trust.blentera.com`. This is application intent, not proof of DNS,
TLS, legal ownership, provider registrations, or hosted deployment.

| Registration | Intended Blentera target from source | Previous live value |
|---|---|---|
| Product website | `https://blentera.com` | Not established by the reviewed source. |
| Application/auth/public API origin | `https://app.blentera.com` (SaaS configuration requires its canonical public-origin setting to agree) | Not established; capture actual production and staging origins from deployment inventory. |
| Documentation | `https://docs.blentera.com` | Not established by the reviewed source. |
| Status provider custom domain | `https://status.blentera.com` | Not established; confirm the provider account's actual page URL. |
| Trust Center | `https://trust.blentera.com` | Not established by the reviewed source. |
| Slack Search OAuth callback | `https://app.blentera.com/api/slack/search/callback` when the configured public origin is the intended app origin | Current live Slack app redirect registration was not available to this review. |
| Customer-managed Slack/Teams OAuth registration | Derived per connection/provider configuration; do not infer a universal callback or customer tenant | Inventory each enabled registration with its customer/provider owner; values were not found in the repository. |
| GitHub repository | Requested destination `augustkring/blentera` | Current GitHub owner/slug and rename authority must be verified by repository operator before scheduling. |

The previous live-value column is deliberately explicit about unknowns. Fill
it from deployment/provider consoles and approved customer configuration
records; do not fabricate a source value from historic package branding.

## Inventory and accountable owners

| Surface | Current software owner / setting | External fact to record before cutover |
|---|---|---|
| Public product origins and contact identity | `PRODUCT_IDENTITY` in `packages/shared/src/product-identity.ts` | Verified domain, DNS/TLS, mailbox ownership and legal entity/contact approval; nullable legal fields remain unresolved in code. |
| Hosted public/auth/API/runtime origins | `server/src/config.ts`; SaaS public-origin validation binds public/auth/API/runtime URL settings to `AW_PUBLIC_APP_ORIGIN` | Deployment inventory of actual old and new origins, proxy/cookie/WebSocket behavior, DNS/TLS and rollback owner. Do not change one origin independently. |
| Browser OAuth handoff | `ui/src/lib/oauthHandoff.ts` and existing connection setup flows | Per-provider client registration owner, exact redirect URI list, scopes, consent/re-consent impact and rollback registration. Customer-managed OAuth apps must be handled by their customer owner. |
| Slack Search OAuth | `server/src/services/connectors/slack-search-oauth.ts`; callback is derived as `/api/slack/search/callback` on the configured public origin | Slack app owner, current registered callback(s), signing/client-secret rotation procedure, tested authorization and callback. Do not infer these from a local callback URL. |
| Slack/Teams app connections | Existing Apps catalog and connection owners (`server/src/services/connectors/`, `packages/skills-catalog/`) | For each enabled install, identify whether the credential/app is Blentera-managed or customer-owned; record provider tenant, redirect/origin requirements, scopes, consent, data owner, and reauthorization plan. The source tree does not identify live registrations. |
| Package/repository identity | Root manifests, adapter/package metadata, release workflow and `doc/plans/2026-10-18-blentera-v10-upstream-integration.md` | GitHub organization/repository owner, package registry publisher, release secrets, webhook/check/app installation owners and accepted rename/redirect behavior. |

Maintain a dated cutover worksheet beside the release change with one row per
actual provider registration: responsible owner, current registration ID and
redirect/origin, intended value, change window, verification evidence, consent
impact, rollback action, and completion timestamp. Store secret values only
in the approved secret manager; the worksheet contains references, never
credentials. A blank or unknown registration remains an explicit blocker.

## Safe sequence

1. Freeze the exact candidate commit and inventory production/staging origins,
   provider registrations, package publishers, callbacks, webhooks, and
   customer-owned installs. Confirm domain control and independent DNS/TLS
   before scheduling a cutover. Keep the old endpoint and registrations live.
2. Prepare the new domain and certificates in parallel. Validate HTTPS,
   trusted proxy headers, canonical auth base URL, Secure/SameSite cookies,
   CSRF/origin checks, API paths, WebSocket upgrades, status/trust/help links,
   email links, and callbacks in a non-production rehearsal.
3. Add new OAuth redirect URIs and provider origins alongside old ones where
   providers support overlap. Rotate secrets only through their existing
   owner and secret-version flow. Verify fresh consent, callback state/nonce,
   connection persistence, refresh, revoke, and reconnect. Do not broaden
   redirect matching or accept an arbitrary Host header to make both origins
   work.
4. Switch the deployment's canonical origin as one reviewed configuration
   change. Verify sign-in, sign-out, session renewal, company access, app API,
   runtime callback, Slack Search callback, and customer-owned OAuth
   re-consent. Observe provider-side delivery and error telemetry without
   recording tokens or callback query secrets.
5. Only after the domain cutover is stable, perform a separate GitHub
   repository rename from the current repository to `augustkring/blentera`.
   First update and verify GitHub Apps, webhooks, branch protections, Actions
   secrets/environments, deployment hooks, package metadata/publish workflow,
   documentation links, and support links. Keep a mirror/backup and the old
   clone remote recorded. Update canonical remotes only after the renamed
   repository and CI are verified; preserve commit history and tags.
6. Keep a rollback window. On failure, restore the previous deployment
   origin/configuration and previous provider registration while both are
   still valid. Revert repository remote/automation changes separately; do
   not rewrite Git history or delete the old registrations as part of
   rollback. Revoke abandoned credentials only after all consumers are moved.
7. Remove obsolete origins and registrations only after the accountable
   domain/provider owners confirm no active clients, pending callbacks,
   customer-managed installs, webhook deliveries, signed-download links, or
   release automation depend on them. Archive redacted change evidence and
   update the identity/source inventory.

## Stop conditions

Stop before any public change if domain control, actual provider registration
ownership, redirect inventory, customer consent impact, rollback access, or
independent TLS is unknown. Do not treat source constants, successful local
OAuth fixtures, a GitHub redirect, or this plan as hosted/provider proof.
No external rename, DNS update, OAuth edit, provider message, or customer
reauthorization has been performed.
