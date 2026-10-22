# Blentera outbound processor controls

The accepted deployment must choose its processors explicitly. Retained upstream
configuration names are compatibility identifiers, not consent to use upstream
services. This document describes current controls; it does not certify a
processor, region, retention policy, DPA or complete outbound-path inventory.

## Feedback trace export

The original feedback owner still requires explicit sharing and tracks each
export outcome. Set `PAPERCLIP_FEEDBACK_EXPORT_BACKEND_URL` only after approving
that receiver for the private trace bundle. Its upload path is `/feedback-traces`.
If authentication is required, set the separate
`PAPERCLIP_FEEDBACK_EXPORT_BACKEND_TOKEN`. Telemetry destination/token settings
do not authorize feedback uploads. With no feedback destination, construction
remains safe and an attempted export fails without sending. The original export
receipt records failure; configuration alone does not establish delivery.

Destinations must be HTTP(S) URLs without embedded credentials, query strings or
fragments. Production processor approval must include transport protection;
plain HTTP support is not evidence of an acceptable production deployment.
Redirects are refused, including redirects that preserve the POST body. Failed
responses produce only the HTTP status in stored diagnostics, not a potentially
private receiver response body. These controls do not establish data minimization
for every bundle field or the receiver's deletion/retention behavior.

## Announcement feed

Remote notices are disabled by default. Both
`PAPERCLIP_ANNOUNCEMENTS_ENABLED=true` and an explicitly selected
`PAPERCLIP_ANNOUNCEMENTS_FEED_URL` are required. There is no automatic Paperclip
feed destination, including when the feed service is constructed directly.
Disabled or incomplete configuration returns no announcement and fetches neither
manifest nor assets. Existing local dismissal history remains durable.

An enabled feed uses the existing guarded HTTPS transport: no URL credentials,
query, fragment or redirects; omitted request credentials; bounded manifest and
asset reads; content-addressed assets; and sandboxed animation documents with a
network-denying CSP. This permits a qualified operator-owned notice feed. It does
not prove that an arbitrary selected publisher's copy or links are approved.

## First-party Telemetry

First-party Telemetry defaults off. Both `telemetry.enabled: true` in instance
configuration and an explicitly selected `PAPERCLIP_TELEMETRY_ENDPOINT` are
required. The destination must be HTTP(S), with no URL credentials, query or
fragment. Existing CI, `DO_NOT_TRACK=1` and `PAPERCLIP_TELEMETRY_DISABLED=1`
suppression remains authoritative. New CLI configuration defaults off; copying
a worktree preserves an existing explicit enabled choice.

There is no built-in processor or fallback destination, and redirects are
refused. Missing or invalid configuration does not create installation state,
hash private references, start flush timers or send events. Enabled clients
retain the existing event envelope, bounded queues and retries, using only the
selected destination. The event contract and dimension restrictions remain in
`packages/shared/src/telemetry/README.md`; selecting a destination does not
qualify its processor, retention or permitted purposes.

Server and CLI configuration is resolved at process initialization. Restart to
apply changed settings. This is not a live consent withdrawal mechanism and
does not promise to clear a previously initialized client's queue. Optional
product analytics policy and live withdrawal remain separate qualification.

## Remaining qualification

The OpenTelemetry operator endpoint must be reconciled along with model,
connector, support, update, package, browser and runtime egress. Feedback,
announcement and first-party Telemetry tests are scoped software evidence.
Full V10-148 inventory, deployment notices, processor legal/region/retention
qualification and actual deployment qualification remain open until their own
evidence is recorded.
