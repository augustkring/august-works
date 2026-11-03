# bd041 general-server failure notes

CI run `bd041` merge source is `e27f79539a8d22b531a7a53781839470c4790d19`.

- Job `121336363279` (general server 2/12): 3 files failed. `agents-service-clear-error.test.ts` asserted `HttpError.message` as an enumerable object field and expected stale text. `error-handler.test.ts` asserted the original `Error` object survived secret-sensitive sanitization; the HTTP response intentionally keeps the trusted Cloud import message while telemetry/context use a generic error. `v9-conversation-authoring.integration.test.ts` ten-task Home request exceeded its existing deadline (owned by Help).
- Job `121336363261` (general server 8/12): the same three failures appeared.
- Job `121336363329` (general server 6/12) and `121336363239` (workspaces A 1/2): the GitHub job-log connector repeatedly returned `Transport closed`. Step summaries confirm `Run grouped general test suites` failed. `curl` to GitHub logs is blocked by the environment CONNECT tunnel (403). Existing focused security-gate triage is documented under `doc/operations/aw-v10-evidence/dependency-high-fixes-2026-10-25/ci-bd041-fixture-triage.md`.

The 2/12 and 8/12 failures were verified from fetched GitHub logs; raw job logs were too large for the connector response. This note distinguishes them from expected error text emitted by passing tests.
