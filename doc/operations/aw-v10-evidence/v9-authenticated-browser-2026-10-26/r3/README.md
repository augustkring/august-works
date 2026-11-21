# Authenticated V9 focused browser rerun r2

This run used the default authenticated setup with the actual signed-in Human and fresh source snapshot. Snapshot, syntax, safe PostgreSQL socket preflight, and Playwright selection all exited 0. Sixteen tests ran: 6 passed and 10 failed. The failures are preserved in the test log and Playwright artifact archive; this is not a green acceptance result.

Passing cases included feedback receipt recovery, saved runtime candidate recovery, workflow publication receipt recovery, workflow test receipt recovery, classic paused-composer behavior, and the P1-P4 Smoke Lab UI/API case.

Remaining failures and causes established by this run:

- `aw-v9-experience.spec.ts`: one timeout used the obsolete “Ask August” accessible name; the account-gate case's anonymous browser context inherited the configured auth state.
- `aw-v9-insight-experiments.spec.ts` and `aw-v9-insight-scenarios.spec.ts`: metric fixture owners still used the fixture helper's `local-board` principal. The current-session actor had already been wired, but canonical metric/scenario `ownerUserId` fields were not updated in this snapshot.
- `aw-v9-project-draft.spec.ts`: `expectedActorId` is canonical `user:<id>`, while the test expected the bare session ID.
- `conference-room-typing-intro.spec.ts`: server-side intercepted `agent-hires` forwarding omitted the actual session cookie, so hire returned 401 and the wizard could not advance.
- `paused-composer.spec.ts`: task-chat case timed out; the classic variant passed.
- `pipelines-tutorial-flow.spec.ts`: the stale item-detail case returned 404 and the learnings UI did not show its expected review card.

After this snapshot, the first five fixture issues were corrected in the main source: current canonical owner IDs, canonical project actor ID, explicit empty storage state for anonymous gate testing, current “Ask Blentera” label, and cookie forwarding on the original agent-hire request. They require a fresh focused run. The pipeline and task-chat failures remain unresolved.
