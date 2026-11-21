# Pipeline event source fences

The full case-history route now checks case body and exact event sources in one current-actor transaction with shared privacy fences and private/no-store responses. The projector receives only checked event IDs. Context packs pin the same checked IDs. This closes append-after-proof disclosure while the filtered company learning feed continues to consider only its requested event kinds and their own sources.

Current source-pinned proof:

- Actual Express + PostgreSQL privacy suite: 4/4 passed (`pipeline-append-proof-r1-20261028`). Includes source hide/member revoke while waiting, and a real private event inserted after proof but before projection: first GET excludes it, next GET denies it.
- Actual Chromium journey: 1/1 passed (`pipeline-case-events-browser-r13-20261028`). The deterministic Human-only history returns 200; adding an event sourced from another Human's private issue yields 404/no-store.

The browser precedes the final internal service-injection seam used by the new PG race test; source snapshots are separate, not an unchanged-head aggregate. Earlier browser attempts remain here, including stale-Postgres startup failures, misleading automation-source fixture assumptions and a response-body assertion error. The corrected fixture explicitly creates the private source; no production source check was weakened. Logs are losslessly compressed with original/stored digests.

This is scoped software evidence, not full V10 or hosted/vendor qualification. No publication or deployment occurred.
