# Agent Platform scoped evidence, 2026-10-28

This bundle archives the focused Gateway, reserved Skill, and OpenClaw adapter runs from `/workspace/v10-preparation/agent-platform-current-source-r17`, plus the corrected OpenClaw bridge boundary unit run from this workspace.

The R17 source snapshot identifies qualification base `886014cae5a7d6ed5a9ab99d62613ec7646308cb` and source HEAD `4367af58e2d7742b51d53ffcdf6b7faf21806c21`. The archived Gateway service, Gateway service test, OpenClaw dispatch test, extension implementation, protocol document, and reserved Skill release registry match the R17 pins. The unit test file was then corrected locally: the fake attestation now supplies the required Gateway IDs and no longer overwrites a deliberately stale assignment digest. `source-pins.json` records that post-correction snapshot. Snapshot and syntax checks passed.

The current focused bridge boundary run used the prepared TypeBox 1.4.1 package with registry integrity recorded in `/workspace/v10-preparation/agent-platform-deps/typebox-1.4.1.json`; the package metadata and build entry hashes are recorded in this bundle's `SHA256SUMS`. The test run passed all 4 bridge boundary cases. It is a unit test with fake Gateway/MCP boundaries and the pinned TypeBox package; it does not qualify OpenClaw vendor runtime conformance.

R17 selected-lane results: Gateway service 3 passed and 57 skipped; reserved Skill 2 passed and 74 skipped; OpenClaw delivery 4 passed and 12 skipped. These are targeted cases, not full package suites. `unit-attempt-1.*` preserves the first local attempt, which caught a bad assignment-digest fixture; the corrected run is `unit.*`.

Security review of the first-party replay path found and fixed an argument-policy omission in the early semantic replay branch. That separate fix passed its focused database-backed regression test; details are in sibling `r2`. First-party replays now re-enter the current semantic or built-in owner only for manifest-classified operations, after current run, Human, Skill, and Tool Gateway policy checks; operations without a qualified owner fail closed. The R17 Gateway run predates that follow-up fix and is retained only as historical scoped evidence.

No live OpenClaw runtime or provider conformance is claimed. The OpenClaw V10 profile remains unqualified pending the pinned runtime and repository serialized adapter/Gateway integration lanes.
