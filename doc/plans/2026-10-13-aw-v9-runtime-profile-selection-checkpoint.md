# Exact private runtime qualification selection

An operator can install multiple distinct configuration qualifications for the
same Agent in the checksum-pinned private profile file. Global profile IDs and
company/Agent/configuration pins remain unique. The current canonical text
configuration selects one exact owned profile. Existing admitted Native workers
with an earlier configuration-only pin match that exact configuration hash.
There is no first-match or implicit alternative fallback.

The worker gateway, representative-test controller, publication checks and
Original stateless conformance controller use the exact selector. Model debits
retain the selected qualification's tariff while current authority is rechecked;
a changed configuration cannot substitute an alternative tariff in an existing
request. Credentials, source/price expiry, runtime binding, provider snapshot,
immutable manifest, budget, envelope and privacy guards remain authoritative.
Installing a profile makes no configuration, binding, grant or activation write.
This does not qualify another transport, CLI or physical sandbox.

Verification is incremental: the representative-test, publication and actual
Native conformance suites pass with an installed unselected alternative. After
preserving the earlier Native configuration-only contract, all 62 profile/worker
gateway cases pass. Explicit tests refuse missing selectors, wrong principals or
companies, wrong profile IDs, ambiguous configuration pins and changed source.
The first worker attempt failed because it incorrectly required an aw_text_only
selector for the earlier admitted Native worker contract; that failure is not
counted as passing evidence.

Full V9 is incomplete. This is preparation for saved runtime candidates. It does
not yet persist a candidate, qualify a virtual candidate configuration, atomically
promote that candidate or implement managed runtime provisioning. The existing
server/src/services/native-draft-conformance.ts controller owns actual bounded
probes and pre-spend reservations; further candidate work must reuse it.

Reference: V9 CUSTOM-09–CUSTOM-12 and protected V6/V7 runtime gates; architecture,
construction, verification, security, reliability and AI/agentic playbooks.

Changed UI/server types, token gates and module boundaries pass on this slice.
