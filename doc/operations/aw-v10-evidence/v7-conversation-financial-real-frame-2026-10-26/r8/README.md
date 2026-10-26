# Conversation reservation financial frame R8

This run used the real authenticated conversation route, current Human session, Native run, manifest, persisted source receipt, and pinned OpenCode binary. Source snapshot and syntax preflight passed. Six selected tests executed: four passed and two failed in offboarding processing.

Passing cases covered current-session/current-generation reservation binding, exact-budget dispatch denial, 64th/65th call boundary, and rollback on a preempted settlement receipt. The actual run was Native and ended with no process PID/group or legacy controller lease, committed finalization with no finalizer lease, and a real local Stop receipt. This confirms the locked legacy-to-Native selection leaves no legacy controller lease attached.

The known-cost canonical purge and unknown-hold offboarding cases remained in `processing`. The exact test failures and bounded Stop facts are preserved in the log. The result does not qualify the full financial/offboarding matrix as green.
