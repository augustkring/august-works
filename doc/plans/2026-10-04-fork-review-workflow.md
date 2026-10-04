# Fork PR review authentication — 2026-10-04

The review workflow stops before its quality gates when a fork does not have
the upstream `COMMITPERCLIP_KEY`. Dependency Review passes in August Works,
but token generation fails for V5 PR #32.

## Change

Keep the configured app token when the app key exists. Without that key, use
the job's built-in GitHub token and identify comments as `github-actions[bot]`.
A configured app authentication failure remains a failure; it never silently
falls back. Tokens are masked, and multiline or missing tokens are rejected.

Select existing comments by both the active bot identity and its signature.
The workflow bot uses its own marker and cannot select a human or app comment.
The app keeps its existing signature and comment compatibility. This prevents
duplicate workflow comments and updates to another bot's comments.

The workflow retains `pull_request_target`, the `master` checkout, Dependency
Review, every existing quality gate, failure exit status, and the existing
permissions. It reads PR data through GitHub APIs and does not execute PR code.
The change supplies authentication; it does not create review approval or a
Greptile score.

## Verification and deployment

Run `node --test .github/scripts/tests/*.test.mjs`. The suite includes app and
workflow token selection, failed app authentication, malformed tokens, real CLI
outputs with a synthetic token, workflow context, comment ownership and
pagination. The same suite already runs in the trusted PR policy job.

The quality-gate functions can also be evaluated against actual V5 PR data
using read-only GitHub requests. That proves the gate results separately from
workflow execution and posts no comments.

This is a separate fix based on `master`. A PR cannot fix its own existing
`pull_request_target` workflow: that workflow executes the base branch. The
bootstrap PR will therefore retain the old missing-key failure until the fix
is merged into `master`. After deployment, trigger a fresh V5 review run using
the updated base workflow, then verify the Dependency Review, token selection,
quality-gate steps and final job outcome. Do not infer deployment or a passing
review job from local tests alone. A rerun of an old workflow run can reuse its
old workflow revision; prefer a fresh PR synchronization event.

V5 application source and its feature flags are outside this change. The
restore-verified V5 workspace archive remains the recovery checkpoint. Preserve
both branches and their Git history.
