# Retained metric source review attempt 104

The exact one-test browser case ran on the pinned snapshot and exited 1 before the metric tool. The first native turn completed. During the second turn, `get_task_context` failed before the provider queried the metric. Its `onNativeInputToolResult` preflight called retained payload access; the new after-lock task-reader ACL recheck returned 403 for the run scope. The test consequently found no metric observation. This is a current-source denial diagnostic, not a source-recovery pass.

The attempt includes the locked-root race fix plus the recheck; it preserves the full test assertion and source guard. The raw snapshot/log/provider trace are retained.
