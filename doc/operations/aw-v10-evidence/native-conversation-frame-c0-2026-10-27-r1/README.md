# Native conversation C0 frame — 2026-10-27, attempt 1

The pinned full `native-opencode-managed-conversation-frame.integration.test.ts` run used the qualified OpenCode binary recorded in `binary.path` and a fresh dependency qualification snapshot. Snapshot and syntax checks passed (exits `0`). The test process exited `1`: four of five tests passed.

The single failure was the signed RuntimeControl relay case (`runs the route-created conversation through RuntimeControl and its signed qualified sandbox relay`). It failed before the model/provider hook ran: the run ended as `native_session_interrupted` with `Sandbox execution scope is stale`, `providerCallCount=0`, and no provider hook/stub error. This result does not qualify that relay journey. The other four cases passed, including the ordinary conversation Task creation and exact result carried into the next request.

Source head: `0fcea368aa1ed3e4c7a20aaaf53be81c7dde5910`. Full source pins and raw logs are retained here. The log is compressed without modifying its contents.
