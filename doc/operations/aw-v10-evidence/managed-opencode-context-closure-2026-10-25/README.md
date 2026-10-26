# Managed OpenCode Context closure evidence (2026-10-25)

This archive records owner-level Context cancellation/privacy evidence and the actual pinned-binary qualification attempts. The binary acceptance test is still **not green**; none of these runs proves actual private R selection or the A/R/B temporal chain.

`context-owner-cancel-revocation.log` is the focused Context-manifest owner suite: 3 passed, 6 skipped, numeric exit 0. Its copied source pin manifest is `context-owner-source-pins.json` (`sourceHead` 40b354f61cb4fc693e007b797da408739802f6ae; qualification base 886014cae5a7d6ed5a9ab99d62613ec7646308cb).

The first qualified actual-binary attempt, `actual-e2e-startup-failure.log`, exited 1 because the installed `opencode-ai@1.18.32` package's original postinstall had not run. The postinstall was then run from the installed package with its matching platform binary; its result and binary hash/path are preserved here. The later `actual-e2e-pre-dedupe-failure.log` also exited 1 at the Context stage under the unchanged runtime deadline.

The latest actual-binary run in this archive, `actual-e2e-witness-failure.log`, exited 1 at the Native Context read-witness gate (`assembleNativeContextRead`, line 1417 in that qualification snapshot). It did not capture a successful `read_context`, so it provides no R-selection or A/R/B evidence. The run used the source snapshot identified in `context-owner-source-pins.json` and the postinstall-completed qualified dependency tree.

All `.exit` files contain the numeric process exit code from the corresponding preserved raw log. These are failure/diagnostic receipts, not a baseline pass.
