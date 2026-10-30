# Conversation-model financial owner run, attempt R1

This attempt used the actual route-backed conversation fixture and pinned OpenCode binary. Snapshot and syntax checks passed; all six selected financial tests executed. The run failed: all six exceeded Vitest's default 30-second per-test watchdog, and the known-cost case also exposed a `tariff` helper name shadowing bug that is fixed in the next source revision. This is failure evidence only; it does not establish any financial or provider-flow acceptance result.

The test-only follow-up raises the Vitest watchdog for these six real-frame cases to 120 seconds, without changing product/provider deadlines, and renames the shadowing local. Source pins SHA-256: `1066316a38a1586aca34abe64e8dcb346940a7cf975fcc65fa865a4938744abc`. Test log SHA-256: `de89c22227069b77d53e5ba30f92e13ef0b390ed0d705df09aa5589725f330df`.
