# Full agent-chat sessions attempt 108

The exact full-file preflight listed all eight tests, and Playwright ran all eight with one worker. Result: 5 passed, 3 failed, exit 1. The source-visibility recovery test passed in the full run. The failures were concurrent first sends/retries, feature-flag history, and Stop plus queued `/new`; each timed out in the shared idle/terminal-state assertions. The server log includes `nativeBootstrapSourceClosureDiagnostic` with unsupported `previousRun`/`resume` witnesses for the failing conversation bootstrap path. No source guard was relaxed from this observation; it needs canonical session/resume witness diagnosis.

Raw test output, exact source pins, preflight receipts, provider events, Playwright error-context attachments, and checksums are retained here.
