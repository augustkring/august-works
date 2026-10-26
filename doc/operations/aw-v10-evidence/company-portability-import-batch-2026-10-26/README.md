# Company portability bounded-import validation

Fresh qualification snapshot and syntax validation passed. The focused Vitest run passed 3 tests: the 50-issue bounded-insert import and the suspended/viewer Human-authority revocation controls after the import counter-row wait. Twelve unrelated tests were skipped by the name filter. The existing 30-second test timeout remained unchanged.

The source pins and raw logs are retained alongside this note. The qualification workspace was copied from the current working tree inside the shared host lock before the test. No install or lockfile change was performed.

The fresh fallback-control run is archived in `current-human-v1-fallback-r1/`. It took a source snapshot and syntax preflight successfully, then passed 7 focused tests with 8 unrelated tests skipped. The 50-issue import test uses `qualifyNativeBundle`, which creates actual manual Human-owned protocol-v1 source Tasks and copies them through the canonical import path; it is not a protocol-v0-only fixture. The 30-second test timeout was unchanged. Source pins identify the qualification base and per-file hashes; the working tree also had unrelated in-progress edits, so the recorded `sourceHead` is not a claim that the entire dirty tree matches that commit.
