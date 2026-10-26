# Authenticated session recovery diagnostic attempt 078

This is a one-test authenticated/private Playwright run with an exact `--list` preflight. The selected recovery test failed before it reached the metric query. Its initial chat `idle()` timed out after 60 seconds with the issue still `in_progress`, zero agent replies, and a live run. The Native provider event artifact records 36 `get_task_context` calls, 35 failed semantic responses, and one successful `get_task_history`; no `query_business_metric` call occurred.

This attempt narrows the early tool failure seen in the full authenticated run, but its semantic bridge error was still collapsed to `semantic_tool_bridge_failed`. Attempt 079 adds a temporary environment-gated service-frame/code-only diagnostic to identify the original throw owner. This archive contains pins, preflights, test log and exits, trace, screenshots, and provider-event facts. It does not establish source qualification.
