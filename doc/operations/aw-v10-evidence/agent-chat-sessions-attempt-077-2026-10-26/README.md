# Authenticated agent-chat sessions attempt 077

This is a complete execution of the eight-test sessions file against a server configured as `authenticated/private` with `bind: lan`. The generated config was checked during the run; the authenticated setup assertion ran before account signup/login. This is not a green suite: Playwright exited 1 with four passed and four failed.

Passed: slow-CPU startup/reload; concurrent first sends/retries; live-source-denial UI contract; sidebar discovery/navigation.

Failed: source-loss UI case timed out after 60 seconds with an active run and no agent reply; its Native provider trace shows repeated `get_task_context` responses containing `semantic_tool_bridge_failed`. Recovery after source loss reached the metric-retention assertion, but the run’s `query_business_metric` capture had `nativeReadResult` and a source set while its `source` binding was null, so it could not prove the exact result receipt. Feature-flag history preservation timed out with a blocked issue and no reply; Stop/new reset timed out its state predicate. These outcomes remain open; this archive makes no source-qualification claim for the unbound metric capture.

The archive includes source pins, syntax/socket/DB-prune/selector/test logs and exits, and Playwright trace/screenshots/provider event diagnostics. The E2E setup now fails closed if its authenticated config regresses to `local_trusted`.
