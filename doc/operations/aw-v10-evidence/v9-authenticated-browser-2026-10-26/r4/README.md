# Authenticated V9 browser acceptance, focused rerun R3

This attempt used the default authenticated Playwright config and actual signup/bootstrap verification session. It selected the focused non-chat V9 browser cases; chat sessions/channels remain with Suite, and connection reviews remain with Scope.

The fresh source snapshot, syntax check, stale-socket guard, and Playwright list check all exited 0. The system Chromium run executed 16 tests under the unchanged per-test deadlines and completed in about 6m20s: 9 passed and 7 failed (test exit 1). It is partial evidence, not a green suite.

Passing journeys included authenticated Insights experiments/scenarios, project draft recovery, runtime candidate recovery, workflow publication and workflow-test receipt recovery, feedback recovery, classic paused composer, and Smoke Lab. The two pipeline tests remain red: one agent-created case references a randomly generated JWT run ID with no persisted producer run, so the real source reader correctly returns 404; the other sees a 500 on pipeline case listing. These fixtures need owner-backed investigation and must not be made to pass by weakening source visibility.

Other failures: Home heading focus expectation; the account-gate check expected workflow copy while the truly anonymous browser correctly shows the sign-in page; both conference wizard attempts received the board-mutation trusted-origin 403 because the Node fetch proxy omitted Origin/Referer (that fix landed after this snapshot); and paused task-chat timed out while classic passed. The next snapshot includes the conference Origin/Referer forwarding and the corrected anonymous sign-in assertion.

Artifacts preserve the exact source pins and all preflight/test logs. `playwright-artifacts.tar.gz` contains screenshots, traces, and error contexts from this run.
