# Authenticated Native chat sidebar regression attempt 054

Fresh pinned-source Chromium run of the single sidebar discovery test. It passed the agent suggestion count, both named search interactions, navigation, configuration links, sidebar ordering, star visibility, and draft preservation. It failed at the independent background-activity assertion: the Beta chat run remained `running` for 60 seconds and emitted no final reply. The provider trace records repeated `get_task_context` calls and no `get_task_history` for that chat. Attempt 055 adds test-only structural logging for those tool results (types and key names only) so the missing active task can be traced without recording content.

The one-test selector, same-snapshot privacy regression, source pins, exact exit, screenshot, trace, and provider event log are retained here. The chat behavior failure remains a real open result; no assertion or timeout was relaxed.
