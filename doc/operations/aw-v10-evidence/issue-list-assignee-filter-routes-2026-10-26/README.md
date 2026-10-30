# Issue-list bounded-pool and cache regression

The fresh current-source snapshot passed syntax preflight and the complete `issue-list-assignee-filter-routes.test.ts` file passed: 20 tests, exit 0. The test uses a ten-connection pool and exercises ten simultaneous identical requests; the route leader now runs handoff-state and recovery-action reads on the current-reader transaction already held by that request. This avoids requiring an eleventh pooled connection while the coalesced waiters retain theirs.

The cache-capacity regression keeps the production limit at 256 and uses the existing test-only limit hook to exercise real route insertions and eviction at a smaller cap within the file's existing test deadline. The malformed parent-cycle list request returns an empty result under current Task privacy validation rather than exposing a cyclic Task projection.

Verification command and source hashes are in `command.txt` and `source-pins.json`. The archive contains the raw Vitest output compressed in `vitest.log.gz` and the snapshot, syntax, and test exit codes.
