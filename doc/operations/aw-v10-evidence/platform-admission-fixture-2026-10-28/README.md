# Native platform admission fixture repair (2026-10-28)

The three Native integration suites now create the canonical server-owned platform Skill admission for each positive material-operation run through `preparePlatformSkillAdmission` and `blenteraPlatformContractHashes()`. The source-erasure suite retains its malformed, foreign, mismatched, cyclic, and over-budget provenance cases. The plugin runtime projection assertion now accounts for the required `blentera-platform` entry alongside the customer Skill while continuing to verify the pinned and current customer versions.

Attempt `r1` exposed one stale expectation in the plugin projection: it required the customer Skill to be the only result. That attempt recorded 42/43 tests passing. The assertion was corrected to explicitly expect both admitted Skills, then `r2` passed all 43 tests.

`r2` used `vitest run` from `server/` with `--maxWorkers=1`, under `/workspace/v10-preparation/v10-pg-tests.lock`. The source snapshot and syntax check ran inside the same lock before the test. Snapshot, syntax, and test exits are all `0`. The raw output is `r2/test.log`, and the full verified source snapshot is `r2/source-pins.json`.

- Source head: `b15547c1492b30507d4988146c507cc9a12f38a6`
- Test result: 3 files passed; 43 tests passed
- Raw test log SHA-256: `b0f74d1cbb2bcb63df1853cce190f793a83872d2313eee87010be0511cfcfb7a`
- Source pins SHA-256: `f9a899162a563f3fd83dcdd09e44f5f2aeb7dc98f9452ae2f267eae781a43322`
