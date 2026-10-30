# bd041 current general-server annotation fixes

Date: 2026-10-26

## Exact failures addressed

- `manual-document-payload-source.integration.test.ts` referenced `issues` without importing it. The test now imports the Drizzle table it queries; production code was unchanged.
- `v7-openshell-prover.integration.test.ts` asserted the obsolete `native_credential_broker_projection_required` warning. The current policy projector reports `credential_broker_binding_missing` for a brokered policy with no bindings. The test now checks that exact fail-closed reason and confirms the projected OpenShell document does not expose credential fields.
- `v6-public-origin.test.ts` used a WebSocket auth database stub that did not implement the actual joined session query or `.limit(1)`, so valid upgrades returned 500 in the test. The stub now supplies the persisted session projection and supports the query methods used by `authorizeUpgrade`; the test still checks invalid origin rejection before session lookup, valid same-company membership, and cross-company denial.

## Verification

Under `/workspace/v10-preparation/v10-pg-tests.lock`, the pinned qualified source snapshot was tested with Vitest:

- `manual-document-payload-source.integration.test.ts`: 10 passed.
- `v6-public-origin.test.ts`: 6 passed, including a real WebSocket handshake.
- `v7-openshell-prover.integration.test.ts`: 3 passed; 4 pinned-prover cases were skipped because `AW_V7_OPENSHELL_PROVER` was not set.
- Combined result: 3 files passed, 19 tests passed, 4 skipped; exit 0.

The full output and source pins are retained in `log`, `exit`, and `source-pins.json`. No production authorization or sandbox behavior was relaxed.
