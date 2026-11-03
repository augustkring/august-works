# Customer-success quality qualification — r3

This portable receipt captures the exact source snapshot and focused checks for V10-094 and V10-097. Start with [the portable source manifest](./portable-source-manifest.json) and [the compressed source snapshot](./source-snapshot.tar.gz). The original [source pins](./source-pins.json) and [source patch](./source-pins.source.patch) are preserved byte for byte; the manifest supplies relative paths for reconstruction. [SHA256SUMS](./SHA256SUMS) covers every receipt file except itself.

## Checks recorded

- Snapshot syntax: 957 copied sources passed.
- Shared package typecheck: exit 0.
- Shared contract test: 2 passed.
- Focused owner integration: 2 passed, 75 skipped. The exact executed cases were:
  - `V9 native customer feedback on migrated PostgreSQL > keeps the original feedback evidence intact when Human triage links an Issue`
  - `V10 authenticated support cases > links a visible support case to a current readable Issue without copying private text`

The selected cases exercise these negative paths:

- A foreign private Issue UUID cannot be linked to a Support case; the route returns 404 without echoing the UUID.
- After a linked Issue becomes private, a different authorized Support-case reader sees no Issue ID and `linkCoverage: unavailable`.
- A Feedback operator who can still read Feedback loses the private Issue ID from both legacy event link fields and the shared evidence projection; another triage link attempt returns 404 without changing the Feedback version.

Both source projections retain native category, lifecycle, recorded impact, current authorization boundaries, and source provenance. Classification remains `unknown` until a Human records it in existing work. The measurement pack distinguishes activation, qualitative Feedback, and Support resolution, with denominator/coverage/missingness limits; the application currently records no structured satisfaction rating or direct customer-effort measure.

The shared and selected integration stage exit files are all 0. The enclosing PTY command reported exit code 1 after its final stage had written `owner-integration.exit` as 0; no wrapper trace or stderr was captured to explain that enclosing status. This receipt claims only the stage results above, not a global-suite or wrapper success. No full server typecheck or full test suite was run.

The raw source patch and new-source copies are preserved byte-for-byte inside `source-snapshot.tar.gz`; extract it before following the relative portable manifest. Logs are stored as `.log.gz` without altering their original bytes. Duplicate uncompressed copies were removed after digest comparison.
