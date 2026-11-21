# Attempt 089: retained-session recovery browser case

The pinned Playwright selector executed exactly one recovery test. Source snapshot and syntax preflight passed; stale-socket and disposable-database preflights passed. The test failed at `idle()` for the second comment after 60 seconds: the conversation remained `active`, one agent reply was present, and one run remained `running`.

RunnerD's bounded diagnostic recorded a conflicting duplicate `semantic_tool.result` for `get_task_context`; the pending semantic result had the same call ID as an already settled result. The fake Codex fixture builds IDs from a process-local turn/step counter, which resets across provider-process restarts. The run did not reach the source-visibility loss or retained-run closure assertions, so this is not evidence for or against retained-run admission.

Raw logs and source pins are preserved with their original names/content. `SHA256SUMS` records each archived file.
