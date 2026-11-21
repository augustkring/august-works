# V7 Learning focused checks

These checks ran against the shared current workspace with concurrent uncommitted repository changes. They are scoped diagnostics, not evidence of a full-suite pass.

The test fixture now creates its current local-board owner with `seedCurrentHumanSourceActor(db, [companyId])` and passes that canonical session actor as `sourceRunActor.authorizationActor`. This keeps the source owner authenticated for workflow source checks and changes no source qualification flags or positive assertions.

| Focused case | Result | Exit | Raw log |
| --- | ---: | ---: | --- |
| `retains current Optimizer source authority and erases native compiler copies: verified_memory` | 1 passed, 41 skipped; 56.01s total | 0 | `v7-learning-verified-memory-focused.log` |
| `retains current Optimizer source authority and erases native compiler copies: workflow_signal` | timed out at the existing 180000ms test timeout; 1 failed, 41 skipped; 201.77s total | 1 | `v7-learning-workflow-signal-focused.log` |

The `verified_memory` case passes with the corrected actor fixture. The `workflow_signal` case progresses beyond the prior authorization failure but has no identified terminal stage yet. Test-only stderr phase markers were added afterward for a later authorized rerun; these logs predate those markers and do not include them.
