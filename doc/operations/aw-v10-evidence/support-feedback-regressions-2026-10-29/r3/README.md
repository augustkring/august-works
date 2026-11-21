# Exact feedback CI failure regressions

The two previously failing `v9-feedback-images.integration.test.ts` selectors passed against source snapshot `20e93dcdf6695987a4832878fa16dbd5c1db6722` in the dependency-qualified mirror under the shared PostgreSQL lock.

- `preserves held content during explicit account erasure and completes only after release and actual object removal`: passed.
- `blocks legacy local company completion until the original protected objects and erasure receipts are confirmed`: passed.
- Vitest result: 2 passed, 29 filtered; exit 0.

The fixture now closes the payer billing account before account erasure and removes the billing association from the local-company case before testing governed object cleanup. No production precondition was weakened. `source-pins.json` and `source.patch.gz` record the exact test snapshot; the compressed Vitest output contains only the selected tests and filtered skips.
