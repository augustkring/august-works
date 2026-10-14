# Original package installation request recovery

The existing Native installation remains the owner. Its immutable company,
installing principal, Agent and initial request ID/hash are retained by the
existing V7/V9 database guards; suspension, updates and uninstall do not rewrite
that identity. This change creates no second installation ledger or domain.

New package form installations retain one UUID before their first POST. The
open form holds its exact parsed input and key in memory. Any explicit resend
uses that identical input/key through the Original owner and its current access,
rollout, admission and pin checks. There is no automatic resend or new-key retry.
A restored browser locator cannot reconstruct input or send a POST.

Both transport acknowledgement and lost response lead to Original read-back:
`GET /api/companies/:companyId/agent-package-installations/requests/:requestId`.
The current Original installing Human, verified active membership and Agent read
are required, with explicit Native local operator behavior retained. Stale
instance-admin claims cannot substitute for membership. The response contains
only company/request/installation UUIDs, current status/version and observation
time. A missing record stays unconfirmed. Current status is not immutable
historical status, proof of a running Agent or verified business outcome.

The metadata read is independent of the new-installation flag. The supporting
`/agents/packages/requests/:requestId` page and the pending-only fallback after
`agent_packages_v7` closes read the same owner. Clearing a matching local locator
requires a current successful Original read. Leaving for Home keeps it. Server
and UI current-account checks still mediate every subsequent operation.

The Source read shares company privacy serialization, a 1500 ms total/statement
budget, a 250 ms lock budget and the existing exact company/principal/request
index. It share-locks the record and current real-account rows. It creates no
assessment, Activity, installation, activation, model call or grant. Current
private GETs detach earlier transport coalescing; a new reader cannot inherit a
request begun before its session check. Private/no-store headers and the existing
normalized private HTTP purpose include reads, writes and rejected methods.
Headers are scoped to package-owned namespaces, rather than unrelated API routes.

The recovery processing purpose is exact original-request reconciliation:

- Storage: same-origin per-tab sessionStorage, key
  `aw.v9.pending-package-installation-requests`.
- Data: company UUID, Native principal identifier and request UUID only; these
  are private pseudonymous locators, not anonymous data. No setup, reason,
  component/name, credential, result or response body is persisted here.
- Bound: 32 scoped entries and 8 KiB, closed parsing and one pending request per
  company/principal. Corrupt, unavailable or full storage refuses new work.
- Lifetime: retain while unconfirmed; clear the exact matching locator after a
  current Original confirmation. Browser tab/session lifetime otherwise applies;
  browser restoration behavior is not a server erasure guarantee.
- Access: another current principal/company cannot render or clear the old
  request as its own. Actor/epoch/mounted-reader fences reject late responses.
- Transmission: only the Original first-party API. No analytics, model/provider
  input, external message or new subprocessors are added.

The supporting Screen Contract is
`doc/experience/v9/contracts/native-package-installation-request.json`.
It does not replace any of the 70 launch-surface acceptance rows. PostgreSQL,
strict transport, controlled lost-response browser and localization evidence
remain software evidence. Hosted authentication/provider/physical runtime,
representative Human and wider package component Source closure remain separate.

Older callers can continue omitting the optional request ID. A new client against
an older incompatible server remains unconfirmed and retains its locator; it
does not switch to a new request key or silently remove the pending record.
Hosted mixed-version and restore rehearsals remain required before qualification.
