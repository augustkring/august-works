# Native history closure test evidence — 2026-10-26

`focused-r6` is the assigned-review task-history source-closure regression: fresh source snapshot and syntax checks passed, and the focused test passed (1 passed, 44 skipped).

`full-r1` is the complete `paperclip-runner-tool-authority.test.ts` run: fresh source snapshot and syntax checks passed, and all 45 tests passed. The separate execution-session wrapper reported exit code 1 after the stored snapshot, syntax, and test phase exits were all 0; its ad hoc wrapper did not write an aggregate exit artifact. This is a wrapper exit-report discrepancy, not a failed test stage.

`signed-relay-r5` records the first actual route-created signed-relay attempt with the typed `native_workspace_prepare` marker propagated. Snapshot and syntax checks passed; the integration failed before host execution and provider IO because RuntimeControl compared the complete prompt (which includes the wake preamble) to the task-Markdown-only digest. The currentness checks remain fail-closed. The fresh source-pin SHA-256 is `1e115d9a49d9194e7c1330b84dd5190d25fc047db315d7a54f22bf7dcb7f1dcc`.
