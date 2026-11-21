# Retained metric recovery attempt 106

The exact pinned browser test completed both Native turns and the metric query, then verified current Human access to the conversation and metric comment history. It also passed the source-withdrawal chat 403, history removal, and fresh conversation creation. It exited 1 only because the test expected `GET /issues/:id/comments` to return 403 after access withdrawal; the route uses `getAccessibleResource(..., "Issue not found")`, so the canonical concealed-resource status is 404. The next attempt updates that stale status assertion while preserving the denial and no-history checks.

The provider event trace records successful `get_task_context`, `get_task_history`, and `query_business_metric` calls. This attempt is not counted as a pass. Raw log, exact source pins, preflight receipts, trace attachment error context, and provider events are retained and checksummed.
