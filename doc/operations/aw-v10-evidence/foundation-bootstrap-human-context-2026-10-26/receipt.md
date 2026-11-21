# Foundation bootstrap Human Context recovery

Date: 2026-10-26

## CI failure and correction

The V7 authenticated browser job failed because pre-run Foundation bootstrap called managed Context assembly without an actual accountable heartbeat Run. The fix keeps pre-run discovery on `inspectReadOnly` under the initiating Human actor, so it does not fabricate a Run or managed manifest. Worker candidate reads continue through `assemble` only when an actual live Run and its assigned bootstrap Task are present.

`submit` and `createProposals` now pass their active publication transaction to `currentSources`/`collect`. `inspectReadOnly` opens its read inspection transaction on that supplied Drizzle transaction handle, making it a nested transaction/savepoint; the enclosing publication transaction remains open until source authorization and publication commit together. The source snapshot cannot escape the publication transaction through the service's outer database handle.

The Foundation integration test uses an actual Human owner and session for pre-run discovery, verifies the pre-run manifest ID is `null`, and supplies a real heartbeat Run for the worker path. The first run exposed a fixture/accountability mismatch; a diagnostic assertion now verifies the bootstrap owner and persisted heartbeat Run owner/agent IDs before the successful worker call. The final integration rerun passed 6/6 (`foundation-fixture-diagnostic.log`, exit 0). CI-stale assertions in the clear-error and error-handler tests were updated to check the actual Error status/message safely and preserve secret sanitization; the focused final rerun passed 17/17 (`stale-assertions-final.log`, exit 0). Earlier failures are retained in `foundation-bootstrap-test.log` and `focused-tests.log`, both exit 1.

## Provenance

- `ci-browser-v7-failure-excerpt.log`: exact browser job failure and unauthorized Context response.
- `ci-server-general-failures.md`: extracted server general-suite CI failures and connector/network limitations for unavailable jobs.
- `foundation-bootstrap-test.log` / `foundation-bootstrap-test.exit`: initial Foundation integration run; worker fixture mismatch retained.
- `foundation-fixture-diagnostic.log` / `foundation-fixture-diagnostic.exit`: final 6/6 Foundation integration run with explicit persisted-owner assertions.
- `stale-assertions-final.log` / `stale-assertions-final.exit`: final assertion rerun and exit code.
- `source-pins-final.json`: source snapshot for initial Foundation verification.
- `source-pins-foundation-fixture-diagnostic.json`: final Foundation source snapshot.
- `source-pins-stale-assertion-fix.json`: source snapshot for final assertion verification.
- `focused-tests.log` / `focused-tests.exit`: initial run, including the corrected stale-message discovery.

`git diff --check` passed after the changes. No commit or push was performed by this task.
