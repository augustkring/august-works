# Retained concurrent Native chat, selected case attempt 136

Attempt 136 ran the exact selected concurrent first-send case from `tests/e2e/agent-chat-sessions.spec.ts` against pinned Chromium. The exact-one-test listing, source snapshot, and syntax checks passed. Playwright passed the unchanged 60-second completion predicate; the case completed in 1.8 minutes (2.3 minutes including startup and shutdown).

The fixture fix made final assistant item IDs derive from each turn ID, which already contains the provider process identity. The resumed run that had previously stopped after `item.started` seq 13 now emitted through seq 20 `turn.completed`, followed by `run.result.accepted` and `run.terminal`. A subsequent run also completed; the chat reached idle and the expected reply count passed.

The run retained the full source-currentness check. Per-event source-access work remained measurable, and `appendEvent` writes were short; the prior timeout was explained by the fixture reusing an item ID across provider process restarts. No timeout or privacy guard was relaxed. The test used Playwright's list reporter to keep generated reports out of the full workspace.
