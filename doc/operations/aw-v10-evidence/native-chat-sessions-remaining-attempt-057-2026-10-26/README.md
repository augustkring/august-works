# Authenticated Native chat sessions full-file attempt 057

Fresh pinned-source Playwright run of all eight tests in `agent-chat-sessions.spec.ts`, using system Chromium. The selected tests were listed before launch, the same-snapshot native failure-log privacy regression passed, and no assertions or timeouts were changed.

Four tests passed: service-worker/reload initialization; concurrent first sends and retries sharing one task; source-loss identity refresh; and sidebar discovery, stars, configuration links, and drafts. Four tests failed: live source-denial history clearing timed out while the run remained active without an agent reply; explicit owner recovery expected HTTP 403 but received 404; feature-flag send/reset timed out with a blocked task and no replies; and Stop followed by queued `/new` missed its completion predicate. Full test details and bounded provider traces are in `playwright.log` and `playwright-output`; raw text payloads are not recorded.

The full-file run exited 1. Numeric exit and source hashes are retained here. These results are diagnostic failures, not a pass.
