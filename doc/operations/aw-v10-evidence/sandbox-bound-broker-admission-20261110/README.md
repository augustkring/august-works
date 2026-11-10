# Sandbox broker executable admission — 2026-11-10

The policy compiler requires broker credentials to bind one immutable executable. Sandbox admission previously accepted only null executable bindings. That contradiction rejected every correctly compiled brokered policy before its current Host checks.

Admission and Task execution now share one predicate. Brokered credentials require a nonempty binding set, one exact executable across all bindings, POST, that executable in the current protected-host broker profile, and all company/presence/destination/executable/lifetime/revocation dimensions. Empty `none` policies retain their existing path; legacy injection remains rejected. Existing current Source, policy hash, qualification, capacity, lease, expiry, Host generation, Stop and recovery gates remain intact.

The signed protocol fixture now honors its original qualification expiry and binds its simulated workload to the exact read-only `/usr/bin/node` executable. Its CWD is inside the declared filesystem policy. It retains the original positive, negative, drift, revocation, replay, cancellation and recovery assertions. No assertion or timeout is waived.

All 112 cases in the three complete sandbox suites pass. The final server TypeScript check also passes. Exact commands, source hashes, resource bounds and clean PostgreSQL exits are archived. Failed exploratory attempts remain explicitly diagnostic. Raw protocol stdout stays private because it can carry ephemeral fixture capabilities.

These are local software and signed Host protocol simulation results. The fixture's synthetic observations do not establish physical enforcement, real provider conformance or release readiness. PR 42 stays draft while the remaining V10 implementation and integrated checks continue.
