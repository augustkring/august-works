# Conversation offboarding predicate diagnosis R17

The fresh source snapshot and syntax preflight passed. The actual known-cost conversation purge case executed and failed. The rollback-only trigger probe showed a nested Run cascade (`triggerDepth=2`) under the matching company tombstone transaction, with the exact Context row still present and bound to the Run. Its Task was neither retired nor the Run's Native Task, and `aw_execution_manifest_payload_erased` returned false. This isolates the missing source proof to Context ownership; no production predicate was bypassed.

The next fix invokes the existing workflow-memory erasure owner while the exact Native conversation Task/Run binding is still available and keeps the resulting content-free Run marker until the Run-owned manifest cascade. R17 does not verify that fix.

`test.exit` and `exit` are `1`; one test executed. Snapshot and syntax exits are `0`. The pinned binary path and digest are retained with the source pins and raw test log.
