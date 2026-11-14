# Native payload invalidation marker forged INSERT repro

- Test: `native-payload-source-binding.integration.test.ts` / “latches invalidation and rejects marker edits and rebinding for every payload owner”.
- Qualification source head: `7dc599641de2fd122f15fce54667a35d75bf6f25` (see source pins).
- Result: one focused test failed because the forged `INSERT ... RETURNING id` succeeded. The first loop owner is `issues`; a new row id was returned. This isolates the issue before comment/attachment parent effects.
- Root cause confirmed from source: migration 0513 rejected any INSERT with `payload_source_snapshot_invalidated IS DISTINCT FROM false`. Migration 0546 replaced the function but omitted that INSERT guard. Once the test owner snapshot has been cleared, the function’s NULL-snapshot early return admitted a forged invalidated issue.
- Fix in current source: restore the original 0513 guard at the start of 0546’s function. Current migration SHA: `aaffb31ade34aa719736f69efbb95fb17af2867932a41d30a157d0572605a80a`.
- The focused run predates the guard fix and is diagnostic evidence only. The corrected migration passes all 29 tests in the full-file run archived under `../full-r1/` (migration SHA and source pins there).
