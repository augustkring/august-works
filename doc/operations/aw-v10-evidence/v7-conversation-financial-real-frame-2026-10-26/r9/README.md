# Conversation reservation offboarding diagnostic R9

This targeted run executed the two actual-frame offboarding cases. Snapshot/syntax preflight passed. Both cases failed, so no full offboarding acceptance is claimed.

The known-cost case proves the Native run had terminal status, `runtimeMode=native`, no process PID/group, no legacy controller boot ID/expiry, committed/unleased finalization, and a persisted local Stop receipt. Its runtime asset retention job succeeded. The remaining offboarding error is `offboarding_reconciliation_pending` after that job, isolating the failure downstream of process Stop/runtime erasure.

The unknown-hold case was still at the retention stage after the fixed four-step test loop. The service selects the oldest eligible offboarding operation globally, so this run does not establish that the new operation itself reached purge. R10 adds bounded per-operation transition diagnostics and a rollback-only typed purge probe.
