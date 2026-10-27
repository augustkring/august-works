# Managed public service health

V10 §§13/43.3 selects a managed status-page provider behind a narrow adapter.
The implementation uses Atlassian Statuspage's public v2 summary contract on
`https://status.blentera.com`. It introduces no local incident/subscriber owner.
Customer-readable components are: Blentera app; Agent work / managed runtime;
Apps & connections; Notifications; Authentication. Unknown/internal component
names are rejected rather than projected into the product.

`BLENTERA_STATUSPAGE_ENABLED=true` enables the public, read-only projection.
It is disabled by default. The application requests only the fixed canonical
origin, with no tenant input, cookies, provider credentials, subscriber details,
redirects or arbitrary destination. Existing guarded transport rejects private
addresses/DNS rebinding. Requests have a three-second deadline, 256KiB limit,
strict public-field validation, 30-second coalesced cache and no stale all-clear
on errors. Provider communication remains authoritative. `/api/service-status`
is public behind the application's Host/origin protections; the independently
hosted status page works without this application or its authentication path.

Help displays the component/incident/maintenance projection plus external
history and subscription entry points. Both app shells display a current
incident/maintenance banner. Human Support remains visible. Subscriptions and
notification consent/delivery are handled on the managed provider's own page;
this application does not subscribe or contact anyone automatically.

## Operator acceptance before enabling GA service health

Configure the managed provider's account, approved public components, custom
Blentera domain/brand, ownership/access and security/privacy contract. Verify:

- independent DNS/TLS and page access with the application/authentication down;
- investigating → identified → monitoring → resolved lifecycle and update history;
- scheduled maintenance window, customer impact and completion;
- explicit subscriber consent, notification delivery and unsubscribe;
- export of components/incidents/history/subscribers and an exit procedure;
- approved postmortem publication with sensitive investigative data excluded;
- API projection failover/unavailable behavior and customer-safe component names.

Retain dated provider/account evidence and the responsible operator. A unit
fixture or configured URL is not evidence that an account, domain, subscriber
notification or published postmortem is operational. This change does not
provision a provider account, publish incidents, send notifications, change
DNS or claim those external gates have passed.

## Customer communication templates

**Investigating / identified:** Customers using [capability] may experience
[observed impact]. [Unaffected capability/workaround] remains available. We
are [verified action]. Our next update is expected [time, if actually known].

**Monitoring / resolved:** [Verified behavior] has recovered as of [time]. We
are [monitoring / confirming recovery]. [Any remaining limitation]. [Link to
verified history or published postmortem, if available].

**Scheduled maintenance:** [Capability] will undergo maintenance from [start]
to [end, timezone]. Expected customer impact: [known impact]. [Workaround, if
available]. We will publish completion or a revised window on this page.

**Postmortem:** [What happened], [customer impact and time window], [remediation]
and [prevention actions with accountable owners]. Link the internal review and
track corrective-action effectiveness separately; do not publish private
customer data, credentials, speculative causes or sensitive security details.
