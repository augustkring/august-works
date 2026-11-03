# Authenticated source-loss UI attempt 079

This one-test Playwright run used the authenticated/private/lan E2E config, listed exactly one source-loss test, and passed 1/1. It reproduces the source-loss UI contract against the authenticated session setup. The temporary semantic-tool diagnostic was enabled, but no `native_semantic_tool_dispatch_rejected` event occurred. Thus the repeated `semantic_tool_bridge_failed` events seen in full attempt 077 were not reproduced in isolation. No source-qualification claim is made by this UI contract test.

The temporary logger was removed after this attempt. This archive retains pins, preflight/test exits, log, screenshot/trace outputs, and the content-free provider trace.
