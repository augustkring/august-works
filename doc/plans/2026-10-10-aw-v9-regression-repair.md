# V9 regression repair

The full original `pnpm test:run` on commit
`a788c400404b8d153f6612d74a64214ee358019c` reported failures in forecasting,
CLI guidance scanning, strategy Source-read coverage and a cold Runner build.
The completed general server regression recorded 861 passing files and 16,400
passing tests, with four failed files (four failed cases and a Runner setup
failure). Later phases did not run. The forecast failure occurred while retaining
an advisory SDK result: its analytical evidence inspection exceeded the original
bounded source budget. The Runner setup failed with `spawnSync cargo ETIMEDOUT`.
These failures remain merge blockers; the original budgets are unchanged.

The CLI scanner must exclude only the root ignored `.paperclip-inbound` upload
inventory, as it already excludes root runtime recordings. It must not traverse
private customer uploads. Authored documentation and source—including nested
directories with those names—remain scanned by the exact unsafe-command rules.
The 39 original/extended scanner tests passed on this repair source. This is a
runtime data-path exclusion, not an allowlist expansion or guidance waiver.
The final full-run stack also identified an unreadable generated Playwright
report. Exclude the six exact ignored browser result/report directories already
declared in `.gitignore`; retain adjacent browser README guidance and unrelated
nested directories with the same names. The fixture requires unsafe commands in
every remaining authored surface to remain detected. The extended scanner check
passed all 39 tests (`v9-regression-repair-cli-v2.log`).

Strategy transport now uses the original authorization owner with a bounded
transaction-local Source scope. An assertion that spies on the former wrapper
cannot observe that owner. Preserve the full scalar-versus-batched Native
snapshot equality check and replace the wrapper-call assertions with actual
persisted agent/token authority outcomes: one allowed task does not permit a
second task, and permission for a task does not permit its project. Both scalar
and batched paths must refuse the entire affected population. Existing hidden,
foreign, duplicate, size, deadline and current human-membership checks remain.

The advisory retention recheck now uses that same original native population
owner in bounded groups of at most 4,000 exact issue/project IDs. Every root and
current project ancestry still receives a current actor decision. Goal admission
and the final suppression check remain in place. No permission is cached across
reads. Actual token-scope and revoked-membership checks cover this evidence path
as well as direct scalar and population reads.

Strategy Source authorization is C3. No authorization decision implementation,
grant, privacy lock, owner batch size, deadline, numerical claim or test timeout
changes in this slice. Its migrated PostgreSQL, unchanged full forecasting and
analytical privacy regression, and strict server checks passed on this repair
source, as recorded below.
Root-wide typing passed before this repair; that result does not qualify this
changed source or imply merge readiness.

The Runner test retains its actual Cargo freshness check and original build
budget. Prepare the same real binaries outside the test before re-running if the
final failure confirms a cold-build timeout; no fake backend, skipped test or
enlarged deadline may stand in for the Native vertical slice.

## Scoped verification completed 2026-10-10

All four supervisors captured the same public Source SHA-256 before and after:
`c63165baf587ffa7a0f50d8b69ec018e083ed9867e9903d90724c431e305a9b5`.
The strict server typecheck passed (`v9-regression-repair-types-v3`).
The actual migrated PostgreSQL and sandbox regression passed all 55 CLI and
strategy cases (`v9-regression-repair-native-v3`). The original five analytical,
forecasting, experiment, authorization and privacy suites passed all 171 cases
(`v9-regression-repair-analytical-v7`). The original Native Codex Runner vertical
slice passed its one durable-result/session-resume case
(`v9-regression-repair-runner-v4`).

The analytical and Runner checks used an owned temporary `PAPERCLIP_HOME` inside
the original unprivileged Native container. The earlier analytical run failed on
a root-owned development secret-store directory and left one sidecar-cleanup
assertion failing; both failures remain in the earlier logs. No customer files
or secret-store permissions were changed. The isolated rerun passed the original
cleanup assertion. The Runner's actual release binaries were built before the
unchanged test freshness check, which completed in 0.39 seconds. All original
source-read and test deadlines remained enforced.

These are scoped repair results. The current combined V9 Source still needs the
required complete typecheck, original full tests and production build. This
slice does not qualify unfinished V9 journeys or establish merge readiness.

## Current integrated Native Codex check — 2026-10-11

The complete original `server/src/services/native-runtime/native-codex-runner.integration.test.ts` passed its durable-result/session-resume case on current integrated HEAD `768c714ca3d36a3efe6715b332fb8dc838be9b60`, with unchanged public Source SHA-256 `c05196c29005c5da0268427e1e8feb0c823746c2cb5b5b6a9902f1f79c472acc` before and after. The actual isolated Native runtime admitted migrated PostgreSQL and the artifact sandbox. The original Cargo freshness command performed a real release build in 8m 58s within its original 600-second budget; setup and the case kept their original deadlines. The actual case took 3,848 ms. No test was filtered, skipped or weakened.

Logs and snapshots: `/workspace/v9-integrated-native-codex-v2-*`. The first current attempt could not import unreadable Git-listed public schema Source; that prerequisite failure is retained in v1 and is not a test pass. Only public Source read permissions were repaired, without changing bytes or accessing customer inbound files. The earlier frozen full-suite timeout remains preserved.

This resolves that one regression prerequisite on this integrated version. Current full typecheck, full test run, production build, unfinished V9 behavior and release review remain pending.
