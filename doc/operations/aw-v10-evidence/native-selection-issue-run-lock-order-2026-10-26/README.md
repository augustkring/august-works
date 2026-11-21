# Native runtime-selection lock ordering

The native selection transaction now locks its company-scoped issue before rereading and locking the heartbeat run. This matches the issue-claim order and avoids acquiring the referenced run before a concurrent claim's issue lock.

The focused PostgreSQL regression holds the issue row, waits until native selection is blocked on that row, then successfully locks the run row from a third transaction. The test passed (1 passed; 308 unrelated tests skipped), with snapshot, syntax, and test exits all 0. This proves the selection does not hold the run while waiting on the issue. It does not claim a reproduced production deadlock or close the separate 034 evidence.

The follow-up snapshot included the final binding and cleanup checks and also ran the existing cancellation-before-selection and cancellation-after-selection cases. All 3 passed (306 unrelated tests skipped), with snapshot, syntax, and test exits 0. Source pins SHA-256: `6cde9593bf600fc742a9c0aaabfe188885b853f77f6a97d40ad92ad39f3dbf5f`. Test log SHA-256: `a4aca604e2aae6ee122cd16a334f4dd3a6d626e2688d0b8c0b931ea1db0c20f0`.

The initial single-test run is retained alongside the follow-up: source pins SHA-256 `8952b3a32dec0f96d842485c89564416c59e939331dc6403f2acb72e4f327cac`, test log SHA-256 `a496e7900e30fe34e4286abcbd1fd30ed5c0ee0ec1374f74edab5bc9197dda4c`.
