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

## Remaining qualification

The separate first-party Telemetry owner and OpenTelemetry operator endpoint
must be reconciled along with model, connector, support, update, package,
browser and runtime egress. Feedback and announcement tests are scoped software
evidence. Full V10-148 inventory, deployment notices, privacy review and actual
deployment qualification remain open until their own evidence is recorded.
