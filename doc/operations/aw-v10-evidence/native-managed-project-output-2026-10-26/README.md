# Managed Native private Project output evidence

This evidence records the focused, pinned integration run for the managed OpenCode `create_project` output constructor on 2026-10-26.

The test executes the qualified local OpenCode binary at `/workspace/.cloud-setup/lockfile/node_modules/.pnpm/opencode-linux-x64@1.18.32/node_modules/opencode-linux-x64/bin/opencode`, SHA-256 `513f500a1a5ea1dc7d865547ac87b32a8936334e8d5abd5b3ff585c45a170080`. The Messages provider is the fixture's local mock endpoint; this does not claim a production Anthropic call or a new provider qualification.

Both attempts use fresh source snapshots from `/workspace/v10-preparation/snapshot-current-source-for-dependency-check.py`, the qualified dependency workspace `/workspace/v10-dep-qualification`, and the exclusive test lock `/workspace/v10-preparation/v10-pg-tests.lock`. They run only `native-opencode-managed-project-create.integration.test.ts`, filtered to “creates a private Project with a local workspace, then consumes that exact result on the next provider request”. The command performs an esbuild syntax preflight on `native-session-executor.ts`, `paperclip-runner-tool-authority.ts`, the integration test, and its fixture helper, then runs the focused Vitest case with `--maxWorkers=1`.

Attempt r13 reached the actual Project creation and provider continuation, including the post-seal source-prefix probe, but failed on a test assertion that incorrectly required the producer issue to appear in the consumed-input policy. The constructor stores that producer link in `projects.sourceIssueIds`; the consumed policy remains the exact policy of the source set. The assertion was corrected to inspect the owner link.

Attempt r14 passed. It verifies the private Project and server-managed local workspace, exact provider tool-use and durable receipt, next-request consumption of the exact persisted source prefix, rejection of a changed Project hash and forged tool-result association, rejection of tampered receipt/result/source-set/workspace/output-capture facts, idempotent replay without duplicate Project/workspace/activity rows, Human privacy behavior, and typed `private_project` completion evidence.

The retained logs include the actual test output, exit status, source pins, syntax preflight, and binary identity for each attempt. `SHA256SUMS` covers these files.
