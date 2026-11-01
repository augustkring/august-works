# R75 recovery delta (corrected capture)

Recovery only. This private checkpoint records frozen deltas and compact receipts against the published R74 chain at current Main HEAD `3f258a5c9c74f31f282e4ec1df77e9385155a6fc`, with unchanged dirty patch D54. It does not activate source or claim broad acceptance.

Capture correction: the earlier prepared R75 accidentally read late R4 assertion bytes (`70d2d715…`) through the R1 path. This corrected archive contains the restored historical R1 assertion (`33e40253…`) with current original-path metadata. The separate late R4 assertion is excluded. The superseded archive and manifest are retained unchanged under `r75-recovery-prepared-nov01-superseded`.

C7 R141 passed its scoped coherent 127-source component set (41 tests, zero skips), full server TypeScript, and exact restore. Its receipt still excludes actual SDK/stopped-C7-effect qualification. R139’s earlier duplicate-import load failure is retained as history. R134 is fixture-only (8/8 unit tests and Oxc parsing); R133 is facet-summary-only.

Host98 pins 114 paths. Its final delta from Host77 consists of three changed production/shared files and one new relay test; the action test passed 1/1, relay tests 9/9, and its restore receipt verifies all 114 pinned sources and compiled outputs. This does not claim full server TypeScript or broader production/Worker acceptance.

Factory-port R1 and R2 remain explicitly unqualified. Their scope/name parser and synthetic-versus-real SDK conversation-tree blockers remain open. The late R4 assertion and active factory work are excluded.

Only compact storage receipts are included; no DB payloads, runtime assets, private IDs, complete Native/Host source bundles, binaries, or `/dev/shm` objects are in this archive.
