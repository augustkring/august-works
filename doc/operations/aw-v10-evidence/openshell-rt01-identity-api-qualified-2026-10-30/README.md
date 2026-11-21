# OpenShell RT-01 R4 scoped qualification receipt

This evidence records the dedicated OpenShell RT-01 workflow run for R4 only. It is not a whole-pull-request or V10 release qualification. R4 remains unqualified for old-gateway compatibility and physical target-host behavior, and profile admission remains closed.

The exact repository head was `4ed298feacdc4f287608b5d392eeeb77a26ff671`; the cumulative vendor patch SHA-256 was `e28fc7fc8b860df810e7bf7337f59a53f2348e3595af6c883992d4ea09bc27d7`. The source-pin manifest is copied here as `source-pins.json`.

The manually dispatched workflow run `41038249001` and qualification job `124004345291` passed. Its source fetch/apply, source-pin verification, format check, generated-protobuf/server/CLI `cargo check`, and nine exact filtered tests all completed successfully. `qualification.log` preserves the source pin checks, cargo check completion and exact test pass lines. `test-result-summaries.log` preserves the nine `1 passed; 0 failed; 0 ignored` summaries.

GitHub retained the full workflow log files in artifact `12969118305` (`openshell-rt01-qualification-logs`), digest `sha256:6d77f246fd368ca9905bc9931ff0102e5bc1a82cf555ef9829a24c57d9b0d5e7`, until 2026-11-06. Run metadata and a direct artifact link are in `run.json`. The full uploaded ZIP is included locally as `openshell-rt01-r4-qualification-logs.zip`; its SHA-256 was rechecked against GitHub’s artifact digest before inclusion. This local copy and the extracted test/build summaries remain useful after GitHub expires its copy.

Files in this receipt:

- `run.json`: exact run, job, head, artifact and scope metadata.
- `source-pins.json`: the R4 source pins used for qualification.
- `openshell-rt01-r4-qualification-logs.zip`: complete original uploaded CI logs, verified against the GitHub digest.
- `qualification.log`: portable selected raw CI log lines.
- `test-result-summaries.log`: all nine test-result summaries.
- `SHA256SUMS`: integrity hashes for the receipt files.

The portable archive includes the full original workflow artifact ZIP, verified against the GitHub artifact digest.
