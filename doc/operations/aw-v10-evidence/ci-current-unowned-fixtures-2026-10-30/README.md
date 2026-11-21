# Current V10 CI fixture qualification

This archive records a focused current-source mirror run for four previously failing CI areas. The exact focused Vitest run passed all 46 selected tests. Vitest reported 24 additional cases as skipped because the name filter selected only the attachment route suite, workspace runtime authorization suite, one guest forecast case, and one restore-migration case. This is not a full-file or repository-wide pass.

The run captured 1,134 changed source files from the current worktree. The source pin manifest and its patch plus added-source archive preserve that mirror capture; the Oxc/Vite parser checked 968 copied files and passed. The four test files' main-worktree bytes and mirror bytes match the qualification hashes recorded in `ownership.json`.

Reproduction metadata is in `runner.json`. `source-pins.json.gz` contains the per-file pins; `source-pins.source.patch.gz` and `source-pins.source-files.tar.gz` preserve the captured source patch and added files. The compressed Vitest, snapshot, and Oxc logs preserve raw hashes and are listed in `SHA256SUMS`.

Only the four fixture files listed in `ownership.json` are the code stage list. The dated evidence directory is also reviewable and may be committed with them. No production authorization or source-admission behavior was changed.
