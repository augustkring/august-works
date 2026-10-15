# V9 paused work observation — 2026-10-11

The original Pause route marks the Agent paused and requests cancellation through
the original heartbeat owner. Scheduling state alone does not prove that an
existing native run, remote process or canonical task has settled (§79.6).

Add a separate bounded read of original queued, scheduled-retry and running
heartbeat runs, independent of the six newest history rows. Current original
Agent and analytical conversation authority must pass before and after the
observation; a retired private conversation closes the entire read. More than
six nonterminal rows produces unavailable, never a zero count. Only fixed IDs
and status metadata are read. No output, configuration or credentials enter
the projection. Original five-second read budget remains unchanged.

The customer monitor explains the original cancellation-request policy in
English and Danish and distinguishes scheduling Pause from pending native work.
Older read owners without this field display an unavailable observation.
No new Pause, Resume, cancellation, retirement, dispatch or authority owner is
introduced. Full draft/test/publish lifecycle and remote stop qualification
remain separate work.

Source tests include an older queued/retry/running row behind eight newer
completed rows, other-company exclusion, source overflow, empty pending set and
private conversation retirement. Actual Native/types/build/browser qualification
is pending; no release acceptance is claimed.

## Completed bounded qualification — 2026-10-11

Actual checks passed: 26 focused cases, Shared/server/UI types, all 15 Native monitor cases and one complete built-browser monitor scenario.

Frozen scope HEAD: `e684a8320e57cf7e01f4cf20bc231b6fe91393ed`. Matching before/after public Source SHA-256: `7632b5a03fedc6bedcbc3dd75d7f50ea446c431aec566a01b48b4d83cbc68b33`. Stage logs and source snapshots are retained under `/workspace/v9-paused-work-monitor-<stage>-v<version>-*`: focused v3, types v1, native v1, browser v1. Earlier failures are preserved. No original assertion, skip policy or deadline was weakened.

These checks qualify this bounded implementation in its own worktree. They do not replace the current integrated full typecheck, test run and build. Built browser transport fixtures do not qualify external provider effects. Full V9 implementation, human acceptance, provider operating proof and review remain open; `sourceComplete` stays false and all 70 launch surfaces stay pending.
