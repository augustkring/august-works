# Current Trust registry qualification

The full current PostgreSQL registry file passes 3/3, zero skipped, exit 0. It checks immutable notice/admin/acceptance/revocation receipts, direct acceptance UPDATE/DELETE refusal with SQLSTATE 55000, and actual company-erasure cascade. No SQL, production code or test oracle was changed for this qualification.

The historical failing receipt identifies an older test file; the current test is different and migration 0557 remains byte-identical. This establishes current behavior and does not assert the cause of that historical failure. Extract `qualification.zip` for the exact capture README, raw test/exit/runner/parser/binary receipts, selected source copies and its original full source-reconstruction ZIP. Raw SHA256SUMS and every reconstruction patch/new-file hash were independently verified before archiving. This is scoped software evidence, not final unchanged-head or hosted qualification.
