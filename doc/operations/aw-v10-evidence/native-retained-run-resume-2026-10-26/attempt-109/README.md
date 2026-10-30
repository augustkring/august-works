# Concurrent first-send witness diagnostic attempt 109

A fresh locked-source snapshot listed exactly one selected Playwright test and executed it once. The test failed at the unchanged 60-second idle predicate: one reply was recorded, while two subsequent native runs failed closed with `unsupported: [previousRun, resume]`, `builder: unsupported_or_missing_witness`, and `wake: ok`. The temporary test-only database facts capture did not appear in retained reporter output; no production admission or source guard was changed.

The raw test log, source pins, preflight receipts, provider event trace, error context, and checksums preserve the actual result.
