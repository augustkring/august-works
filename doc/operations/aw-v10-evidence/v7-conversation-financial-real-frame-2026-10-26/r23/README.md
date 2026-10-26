# Actual conversation usage and purge test R23

The pinned-binary and source snapshot/syntax preflights passed. Vitest executed one real-frame test and failed one post-run assertion because it expected the company CostEvent to remain after successful canonical company purge. The fixture had reached the provider-backed known-cost conversation and purge path; purge correctly removed the payload billing row, so the exact debit must be asserted before purge and the content-free aggregate after purge. The test was corrected to make those checks at the appropriate lifecycle boundaries. This run is diagnostic only; it is not acceptance evidence for the financial suite or purge.

The command used the qualified OpenCode binary recorded alongside the source pins and ran only the named known-cost test. Numeric exit: 1. The immutable raw test log is preserved here.
