# Managed Project source-wait regression

These artifacts are local verification evidence for the new pinned-provider test `native-opencode-managed-project-create-wait.integration.test.ts`.

- `r1` ran the actual managed OpenCode fixture and observed the Project constructor waiting on the retained Task row. The blocker completed the Task mutation, after which the runner ended with `managed_opencode_runner_exit_1` because the failed tool paused its plan and the fixture's next provider request was rejected. The test itself exited 1 because its first assertion expected the inner Task-source error text on the outer runner error. Assertions after that message check did not execute, so this run is diagnostic only.
- `r2` reran with the runner-boundary assertion corrected. It passed 1/1: the test observed the actual row wait, committed a Task title change, verified the mutation remained, and verified that no Project, workspace, `project.created` activity, or managed Project receipt was committed.

Both runs used the qualified OpenCode binary recorded in the adjacent `.binary.path` and `.binary.sha256` files, a fresh source snapshot, syntax preflight, the exact shared host flock, and the repository's stale disposable Playwright socket cleanup script. Source pins and raw logs are preserved per attempt.
