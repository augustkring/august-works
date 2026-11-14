# Native runner diagnostic callback supervision

The runnerd diagnostic and provider-ingress state callbacks now supervise rejected `onLog` delivery. A rejection revokes the current Native tool authority, requests one in-memory session cancellation, and consumes any cancellation rejection. Heartbeat's durable source-loss cancellation remains owned by `onLog`.

The fresh-source focused Vitest passed 2 tests; 475 other cases in `native-session-executor.test.ts` were filtered. The integration case verifies there is no unhandled rejection and that subsequent dynamic tool execution fails with `native_tool_authority_epoch_revoked`. The helper case verifies cancellation is requested once and a cancellation rejection is contained.

`native-callback-supervision-final-20261026.log` and `.exit` preserve the test output and numeric result. `native-callback-supervision-final-20261026-pins.json` records the exact source snapshot; snapshot and syntax sidecars each exited 0. This is focused callback evidence, not a full executor-suite result.
