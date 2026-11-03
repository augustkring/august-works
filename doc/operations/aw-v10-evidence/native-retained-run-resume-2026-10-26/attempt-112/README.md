# Concurrent first-send witness attempt 112

This fresh locked snapshot passed source syntax and exact one-test listing preflights. It executed the unchanged concurrent-first-send test once and failed the existing idle predicate after its 60-second watchdog (exit 1).

The prior `wake_version` rejection is resolved: the test-only retained-run facts show protocol version 1, valid receipts, and matching intent/dispatch counts for both runs. One agent reply is visible. The remaining failure is later in the same flow: the provider event trace records one `get_task_history` result as `failed: true` and another as successful. The current run stayed `running` until the test cancelled it; no pass is claimed. The attempt did not enable the temporary Native source-closure diagnostic environment flag.

Raw test output, exact source pins, preflight logs/exits, provider event trace, Playwright error context, screenshot, trace, and actual exit status are preserved here.
