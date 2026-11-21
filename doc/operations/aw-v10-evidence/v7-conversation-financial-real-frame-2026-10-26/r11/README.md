# Conversation reservation purge constraint diagnostic R11

The single actual-frame known-cost purge case executed with passing snapshot/syntax gates. It failed after runtime asset erasure had succeeded; the authenticated Native Run had no process PID/group or legacy controller fields, committed/unleased finalization, and a real local Stop receipt.

A rollback-only invocation of the canonical `purgeCompanyContent` owner identified SQLSTATE 23514 and constraint `aw_v5_execution_manifest_immutable`. This points to the generic company cleanup directly deleting an immutable execution manifest while its heartbeat Run row still exists. R12 applies the narrowly scoped parent-Run cascade path and reruns the actual purge. This is not a green offboarding result.
