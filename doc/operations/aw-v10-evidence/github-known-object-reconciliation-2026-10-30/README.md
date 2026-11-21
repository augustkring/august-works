# GitHub known-object reconciliation evidence (2026-10-30)

This change adds version-safe event handling and bounded per-object recovery for GitHub Issues and Pull Requests already linked from Paperclip content. It does not add a repository-wide content feed, durable provider cursor, completeness watermark, or gap detector. Lifecycle cursor, watermark, and gap status remain `not_reported`; Slack Connected Knowledge cursors are request-scoped.

The webhook owner compares GitHub `updated_at` under the exact company/provider/object row lock. Older, invalid-version, and equal-version conflicting event bodies are rejected and scheduled for canonical refresh. Only an applied snapshot or an equal snapshot already held by that row can provide the merged-PR fast-path hint. An untracked row cannot authorize a merge hint. API refresh uses version/claim compare-and-set to avoid overwriting a concurrent event; ETag/304 is scoped to one known object. Bounded polling reconciles missed changes only for already-known objects.

Older stored closed GitHub objects may still carry the former terminal flag. The scheduler treats closed Issue/PR snapshots as refreshable while preserving terminal merged and canonical not-found objects; no migration or backfill is needed.

Qualification used `/workspace/v10-dep-qualification`, never MAIN dependency commands. R1 and r2 each passed both focused server suites (33/33) before the legacy-terminal compatibility addition. R3 captured the compatibility change and passed the affected `external-objects-service.test.ts` suite (30/30). No live provider calls or full server TypeScript check were performed. Each snapshot ran the pinned Vite/Oxc syntax checker: 979 JS/TS files parsed for r1/r2 and 982 for r3. Source snapshots copied 1,147 paths for r1/r2 and 1,150 for r3.

- r1 source head: `3bdafc28b15f35704717c2e8a4fd313c274547be`.
- r2 source head: `45e3edba7a712d765636e6aa44a2e52844dcb4ff`.
- r3 source head: `45e3edba7a712d765636e6aa44a2e52844dcb4ff`.
- r3 source-pins SHA-256: `831d66fd41d8c478e00b6530fc03b84d82a2fb569624a5921d48bdff3395795e`.
- Current stage candidate base: `45e3edba7a712d765636e6aa44a2e52844dcb4ff`.
- r3 runner: `/workspace/v10-preparation/run-connector-github-known-object-reconciliation-r3-20261030.sh`.

The exact candidate source files and hashes are in `source-stage-candidate-hashes.json` and `source-stage-candidate.sha256`; verify them from the repository root with `sha256sum -c doc/operations/aw-v10-evidence/github-known-object-reconciliation-2026-10-30/source-stage-candidate.sha256`. `stage-list.txt` is the complete intended staging boundary, including this evidence bundle. Raw r1/r2 receipts remain unchanged; the compact tar contains their original source pins, patches, new files, syntax/test logs, plus the r3 receipt and final six-file source reconstruction. The broader qualification snapshots include unrelated concurrently dirty source needed to preserve exact test inputs, but those paths are not stage candidates.
