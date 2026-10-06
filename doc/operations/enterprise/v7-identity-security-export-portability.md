# V7 enterprise identity, security events and portability

Date: 2026-10-05. This runbook covers local implementation and protocol evidence. Enterprise GA additionally requires an actual approved customer IdP, observed deployment/recovery evidence and the applicable contractual operating requirements.

## Identity activation

1. Keep `enterprise_identity_v7` off until its effective SaaS/governance prerequisites and actual deployment configuration are current. Public registration, provider mutation and implicit JIT remain disabled.
2. A current native company owner saves a draft in Company settings → Enterprise. Record the exact issuer and company domain. A domain does not grant company membership. Duplicate domain selection is rejected as ambiguous; a configured provider ID selects an exact native policy.
3. For OIDC, store the private RSA signing key through the existing encrypted company secret service. Configuration pins its actual current version; qualification also pins its value digest. Qualification parses the actual encrypted RSA private key, requires at least 2048 bits and checks its native value digest. Rotation, deletion or revocation invalidates the old authentication qualification. Use private-key JWT, PKCE and signed ID-token identity; email/UserInfo is not identity authority. SDK OIDC validation rejects private endpoint resolution and redirects. Qualify live DNS/endpoint behavior and token/JWKS handling in the target environment; a local operator reference is not a network qualification.
4. For SAML, record the current X.509 IdP signing certificate and entry point. The SP metadata route is `/api/auth/sso/saml2/sp/metadata?providerId=...`; ACS is `/api/auth/sso/saml2/sp/acs/:providerId`. Configure the IdP against the actual metadata, correlated requests, signed assertions, timestamps and supported algorithms. Unsolicited/forged callbacks cannot create native sessions.
5. Map verified existing company users to exact signed issuer/subject values. There is no email-match account linking, automatic new-user creation, owner lifecycle management or IdP group permission grant. Use native member/invite/ownership controls for those operations. Revoking an existing mapping is terminal and available after feature rollback; it does not delete global users or unrelated memberships.
6. A verified configured platform qualifier supplies the protected current-build evidence reference and exact policy version/configuration hash. Evidence expires within 30 days. The server does not fabricate or automatically verify a remote artifact's bytes.
7. SCIM requires explicit owner-approved non-owner lifecycle mappings. Rotate the random bearer credential with both policy version and current credential ID; the value is returned once and expires within 90 days. Credential validity also requires current identity qualification. Native authentication metadata binds company/connection/issuer namespaces. Revoked bindings cannot be restored by replaying SCIM state.
8. SCIM deactivation changes the approved native company membership and deletes its scoped grants in the real framework transaction. It retains the native global profile, sessions and other-company access. Re-activation does not recreate deleted bespoke grants. Native role policy remains authoritative. Decommission an existing SCIM namespace before removing it. The native owner action suspends scoped managed non-owner memberships, revokes their mappings, removes that connection's SDK metadata and requires fresh identity qualification; it preserves other companies and global users/sessions. Suspension revokes credentials immediately.

## Security-event receiver

Enable `security_event_export_v7` only with its effective prerequisites. A current owner opts into a fixed public HTTPS webhook and a dedicated native encrypted signing-secret version of at least 32 bytes. Existing inactive policies can be disabled after feature rollback or key revocation.

The canonical `activity_log` remains the source. A transaction trigger enqueues selected fixed native action types for that company; rolling back the source rolls back its delivery. The outbox contains delivery metadata and references, not another audit log or copied details. There is no automatic historical backfill. The delivery vocabulary intentionally excludes secret-resolution events to avoid recursive delivery.

JSON payload:

```json
{"schemaVersion":"aw.security-event.v1","eventId":"native UUID","companyId":"native UUID","action":"secret.rotated","occurredAt":"ISO timestamp"}
```

Verify `X-August-Signature` as `v1=` plus hexadecimal HMAC-SHA256 of `timestamp + "." + eventId + "." + exactBodyBytes`, using `X-August-Timestamp` and `X-August-Event-Id`. Compare in constant time. Require a bounded timestamp window (for example five minutes) and durably deduplicate company/event IDs for at least the delivery lifetime. A replay or lost acknowledgment must not apply the event twice. Return 2xx only after durable receiver acceptance. The timestamp/signature changes on retry; the native event ID remains stable.

The existing control loop consumes bounded batches. Delivery checks current owner authority, configuration revision, effective flags, event membership and actual signing-secret version/digest. It uses the existing DNS-pinned public HTTP transport, refuses redirects/private destinations and cancels response bodies. Time limits are 15 seconds per request and a 90-second recoverable lease; retries consume a cumulative maximum of five attempts. A lost final lease cannot create a sixth attempt. Changing configuration cancels its older pending deliveries. Lost acknowledgments can cause duplicate network delivery, so receiver deduplication is mandatory.

Pending delivery capacity is 1000 per company. Overflow increments an inspectable omission counter; it is not silently represented as successful delivery. Metadata and retries expire after 24 hours. Source retention/deletion cascades delivery references. None of this changes the native audit retention policy. Qualify receiver reachability, signatures, replay handling, failure recovery and customer-approved retention in staging before contractual SIEM use.

## Portability

The native company export has an explicit **Include company V7 state** option. It adds `august-works-state-v7.json` to the existing archive. The separate authenticated download is `GET /api/companies/:companyId/portability/v7?expectedUserId=...`. Both require current native owner authority, independent of feature rollout and paid entitlements.

The extension contains open JSON files for Foundation and knowledge revisions, shared Memory/lifecycle/evidence, eligible observations/models, provider binding metadata, Role Packs and assignments, Playbooks, installed package references/licenses, Workflows, purpose/assessment/oversight/obligation metadata and content-free audit summaries. Existing native company bundles retain agents/Skills/Projects/Tasks and policy-authorized artifacts. No 100-row UI limit applies to the state export. Privacy locking serializes export with source erasure. Private agent Memory, erased retained revisions, ineligible derived payloads and credential values are excluded. The files map has a deterministic digest after credential redaction.

The V7 extension is an export format; automatic import into active native authorities is deliberately absent. A migration/import implementation must recreate customer content under current native scope and retained deletion markers, then require fresh membership, secrets, approvals, provider connectivity, activation and sandbox qualification. Package references do not override third-party redistribution licenses. Contracted exit rehearsal must use the actual customer corpus and artifacts; local fixture export is not that rehearsal.

## Operating evidence

Identity qualification does not certify the operating envelope. Recorded AW processing regions differ from customer-selected provider regions. Record each supplier's actual purpose, categories, regions, DPA/status, retention, assurance, criticality and exit path through the existing inventory/governance evidence surfaces; unknown provider facts remain unknown.

Contracted dedicated placement must be checked against actual native runtime placement. Retention changes must use actual Memory/source/audit/storage/backup policies and prove erasure/restore behavior. Use existing native scoped support approval, backup/recovery, SBOM/patch and incident evidence. An enterprise policy description alone cannot enforce a region, retention contract, dedicated VM or legal obligation.

Maintain an AW-as-provider NIS2 applicability assessment with actual service/control model, size/threshold facts, cloud and managed-service analysis, jurisdiction/main establishment, responsible reviewer, conclusion/evidence, review dates/triggers and any resulting registration/notification duties. Until reviewed facts and actual controls exist, the conclusion remains unassessed. DORA/ISO/NIST/AI standards are evidence mappings, not certifications. Actual procurement/legal approval and target-environment operating evidence remain enterprise launch gates.

## Migration and rollback

Apply schema migrations in order. The additive compound activity identity constraint precedes the outbox FK. Its index construction on an existing large activity log needs a reviewed production migration window or an online-index preparation plan; local database fixture timing is not a production estimate.

Disable delivery/identity flags first during rollout rollback. Native owner suspension, mapping withdrawal, export and retention cleanup remain available. Preserve the pinned SCIM patch: removing it restores the SDK default global session deletion. Restore tests must retain revoked subject bindings, delivery terminal states and Memory deletion markers; do not reinstate old authority merely because an old backup contains it.
