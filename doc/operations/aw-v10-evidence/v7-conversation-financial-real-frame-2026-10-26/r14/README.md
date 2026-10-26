# Conversation reservation purge predicate diagnostic R14

Fresh snapshot passed and one actual known-cost conversation purge case executed. The purge remained blocked by `aw_v5_execution_manifest_immutable` despite a completed Native run, successful runtime asset erasure, and the Run-owned dependency ordering. A rollback-only trigger-function replacement was intended to add a finite boolean `DETAIL`; the filtered failure facts did not include that diagnostic. R15 adds only allowlisted detail-shape fields to determine whether the driver surfaced it. No trigger behavior was relaxed.
