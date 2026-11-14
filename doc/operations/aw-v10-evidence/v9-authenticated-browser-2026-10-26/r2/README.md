# Authenticated V9 broad browser attempt r1

This is a software-only browser run using the default setup's real signup, bootstrap claim, native SDK verification token, and verify endpoint. No outbound email or seeded authorization grants were used. Chat-session and chat-channel specs were excluded because Suite owns them.

The run took a fresh source snapshot, syntax check, Playwright list check, and stale PostgreSQL socket preflight; all four exited 0. Playwright selected 49 tests in 31 files. The 900-second test harness guard stopped the run after 48 cases, before the final Smoke Lab case; the test runner exited 124. The run produced 31 passes, 16 failures, and 1 spec-level skip. This is partial evidence, not a green broad-suite result.

Failures in this snapshot:

- `aw-v9-experience.spec.ts`: Home and feedback cases used English copy assertions while the authenticated account's persisted locale was Danish. The workflow account-gate case also assumed an unverified fixture, while this authenticated bootstrap deliberately verifies the account.
- `aw-v9-insight-experiments.spec.ts`: the direct service fixture used `local_implicit` instead of the authenticated Human session, yielding 409.
- `aw-v9-insight-scenarios.spec.ts`: the scenario's direct-service owner used `local_implicit`, so the current session could not see the resulting scenario.
- `aw-v9-project-draft.spec.ts`: the English Home heading assertion ran in Danish.
- `aw-v9-runtime-candidates.spec.ts`: timed out with Danish UI copy where English labels were expected.
- `aw-v9-workflow-publication.spec.ts`: timed out in a Danish UI snapshot.
- `aw-v9-workflow-test.spec.ts`: the English workflow-input label was absent in the Danish UI.
- `conference-room-typing-intro.spec.ts`: both tests timed out waiting for the English “Get started” button while the account remained Danish.
- `connection-reviews.spec.ts`: approve failed on the old pinned inline-script implementation; decline/always/failure passed, restart was spec-skipped. Scope owns this spec and has a current follow-up.
- `paused-composer.spec.ts`: the task-chat variant timed out; classic variant passed. Both used English UI copy without locale isolation.
- `pipelines-tutorial-flow.spec.ts`: one request failed with 500 and another with 404; requires separate fixture/product diagnosis.
- `smoke-lab.shared.ts`: browser page crashed under this long run.
- `smoke-lab.shared.ts`: the browser page crashed during the long run.

After this run, affected English-copy tests registered the existing account-locale isolation helper, and insight experiment/scenario setup switched to the real current Human session actor. Those changes are not exercised by this snapshot. The source pin manifest is `source-pins.json`; logs and Playwright failure artifacts are preserved alongside it.
