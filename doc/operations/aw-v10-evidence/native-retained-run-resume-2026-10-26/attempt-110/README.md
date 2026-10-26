# Concurrent first-send witness diagnostic attempt 110

A fresh locked-source snapshot listed exactly one selected Playwright test and executed it once. The test failed at the existing 60-second idle predicate: one reply completed and two later Native runs failed closed because the prior-run witness was unsupported.

A temporary test-only bounded database capture showed the first successful Native run had a fully matching checkpoint identity, present Human/session/generation, but `nativeInputSourceProtocolVersion: 0`, an invalid/missing retained input receipt, and one dispatch intent with no recorded receipt dispatch. This makes the later fail-closed decision consistent with current admission rules; the underlying missing source receipt is still being traced. No source guard was relaxed.

Raw test output, source pins, preflight receipts, provider event trace, Playwright error context, screenshot, trace, and checksums preserve the result.
