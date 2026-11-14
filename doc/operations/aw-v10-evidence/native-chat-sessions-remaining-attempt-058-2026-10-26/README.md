# Authenticated Native chat source-denial case attempt 058

Fresh pinned-source Playwright run of the single `live source denial removes cached chat history without a reload or implicit replacement` case, using system Chromium. The test was listed before launch, the same-snapshot native failure-log privacy regression passed, and the original assertions/timeouts were retained.

The test passed in 21.8 seconds. Its provider trace shows one successful `get_task_context` and one history read before the UI receives the explicit source-loss event; the trace contains only tool names, statuses, and bounded shape metadata, no tool payload text. The run exited 0. Numeric exit, full log, source hashes, and browser trace are retained here.
