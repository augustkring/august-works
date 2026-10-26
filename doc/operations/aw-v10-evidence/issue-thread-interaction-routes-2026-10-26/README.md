# Issue thread interaction route fixture verification

This evidence records the current-source route-suite check after the test fixture gained a narrow current-issue privacy model for the public-write admission boundary. The model keeps public fixtures readable, denies unauthenticated reads of a private fixture, and preserves the existing analytical-source denial assertion. No production authorization behavior was changed.

The focused private-Task case confirms the route returns 422 and does not resolve the interaction or queue a wake. The existing analytical-source denial case continues to confirm a denied current source prevents interaction-history reads.

Command, from the qualified workspace server directory, under `/workspace/v10-preparation/v10-pg-tests.lock`:

```sh
../node_modules/.bin/vitest run src/__tests__/issue-thread-interaction-routes.test.ts --maxWorkers=1
```

Result: 83 tests passed, 0 failed. `test.exit` and `snapshot.exit` are both 0. The exact source snapshot is in `source-pins.json`; raw Vitest output is gzip-compressed in `test.log.gz`.
